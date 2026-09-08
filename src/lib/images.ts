import "server-only";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { images } from "@/db/schema";
import type { Actor } from "./review";
import { IMAGE_ID, ImageError, imageReferences } from "./image-markdown";
import { getObjectStore } from "./object-store";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export async function beginImageUpload(input: unknown, actor: Actor) {
  const body = input as { filename?: unknown; contentType?: unknown; size?: unknown } | null;
  if (!body || typeof body.filename !== "string" || !body.filename.trim() || body.filename.length > 255 ||
    typeof body.contentType !== "string" || !TYPES.has(body.contentType) ||
    typeof body.size !== "number" || !Number.isSafeInteger(body.size) || body.size <= 0 || body.size > 10 * 1024 * 1024) {
    throw new ImageError(400, "请上传 10 MB 以内的 PNG、JPEG、WebP 或 GIF 图片");
  }
  const id = randomUUID();
  const stagingKey = `staging/${id}`;
  const signed = await getObjectStore().presignUpload(stagingKey, body.contentType);
  await getDb().insert(images).values({ id, uploadedBy: actor.id, filename: body.filename, contentType: body.contentType, size: body.size, stagingKey });
  return { id, ...signed, expiresIn: 300 };
}

export async function completeImageUpload(id: string, actor: Actor) {
  if (!IMAGE_ID.test(id)) throw new ImageError(404, "图片不存在");
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(images).where(eq(images.id, id)).for("update");
    if (!row || row.uploadedBy !== actor.id) throw new ImageError(404, "图片不存在");
    if (!row.objectKey) {
      const store = getObjectStore();
      const metadata = await store.head(row.stagingKey);
      if (!metadata) throw new ImageError(409, "上传尚未完成，请重试");
      if (metadata.size !== row.size || metadata.contentType !== row.contentType || !metadata.etag) throw new ImageError(400, "上传文件大小或类型与声明不符，请重新上传");
      // 新 key 从不发 PUT 签名。CopySourceIfMatch 保证冻结的正是刚校验的对象。
      const objectKey = `images/${randomUUID()}`;
      await store.copy(row.stagingKey, objectKey, metadata.etag);
      await tx.update(images).set({ objectKey, publishedAt: actor.role === "admin" ? new Date() : null }).where(eq(images.id, id));
    }
    return { id, src: `/api/images/${id}` };
  });
}

export async function imageReadUrl(id: string, actor: Actor | null) {
  if (!IMAGE_ID.test(id)) throw new ImageError(404, "图片不存在");
  const [row] = await getDb().select().from(images).where(eq(images.id, id));
  if (!row?.objectKey || (!row.publishedAt && actor?.id !== row.uploadedBy && actor?.role !== "admin")) throw new ImageError(404, "图片不存在");
  return getObjectStore().presignRead(row.objectKey);
}

/** 创建提案时校验所有引用；私有图片只能由上传者或管理员提交。 */
export async function validateImageReferences(db: Db | Tx, content: string, actor: Actor) {
  const ids = imageReferences(content);
  if (!ids.length) return;
  const rows = await db.select().from(images).where(inArray(images.id, ids));
  if (rows.length !== ids.length || rows.some((row) => !row.objectKey || (!row.publishedAt && row.uploadedBy !== actor.id && actor.role !== "admin"))) throw new ImageError(400, "图片尚未上传完成、不存在或无权引用");
}

/** 与修订同一事务发布引用；待审或驳回从不走此路径。 */
export async function publishImageReferences(tx: Tx, content: string) {
  const ids = imageReferences(content);
  if (!ids.length) return;
  const rows = await tx.select().from(images).where(inArray(images.id, ids));
  if (rows.length !== ids.length || rows.some((row) => !row.objectKey)) throw new ImageError(400, "引用的图片不存在或未完成上传");
  await tx.update(images).set({ publishedAt: new Date() }).where(inArray(images.id, ids));
}

export function imageErrorResponse(error: unknown): Response {
  if (error instanceof ImageError) return Response.json({ error: error.message }, { status: error.status });
  // SDK 错误可能包含签名地址；不传给客户端。
  return Response.json({ error: "图片存储暂不可用，请稍后重试" }, { status: 503 });
}
