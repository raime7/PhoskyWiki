import { randomUUID } from "node:crypto";
import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import { expect, it } from "vitest";
import { r2ObjectStore } from "@/lib/r2-object-store";

// 显式独立 R2 测试桶；未配置时跳过，配置后错误必须报红（不吞网络错误）。
const { R2_CONTRACT_ENDPOINT: endpoint, R2_CONTRACT_BUCKET: bucket, R2_CONTRACT_ACCESS_KEY_ID: accessKeyId, R2_CONTRACT_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
it.skipIf(!endpoint || !bucket || !accessKeyId || !secretAccessKey)("ObjectStore 契约：真 R2 预签名 PUT、元数据、条件复制冻结、预签名 GET", async () => {
  const config = { endpoint: endpoint!, bucket: bucket!, accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! };
  const store = r2ObjectStore(config);
  const client = new S3Client({ endpoint, region: "auto", credentials: config });
  const source = `staging/${randomUUID()}`;
  const frozen = `contract/${randomUUID()}/frozen`;
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVYQAAAAASUVORK5CYII=", "base64");
  try {
    expect(await store.head(source)).toBeNull();
    const signed = await store.presignUpload(source, "image/png");
    expect(new URL(signed.url).searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect((await fetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes })).ok).toBe(true);
    const metadata = await store.head(source);
    expect(metadata).toMatchObject({ size: bytes.length, contentType: "image/png" });
    await expect(store.copy(source, frozen, '"wrong-etag"')).rejects.toThrow();
    await store.copy(source, frozen, metadata!.etag);
    expect((await fetch(signed.url, { method: "PUT", headers: signed.headers, body: "replacement" })).ok).toBe(true);
    const read = await fetch(await store.presignRead(frozen));
    expect(read.ok).toBe(true);
    expect(Buffer.from(await read.arrayBuffer())).toEqual(bytes);
    await expect(store.deleteStaging(frozen)).rejects.toThrow("INVALID_STAGING_KEY");
    await store.deleteStaging(source);
    await store.deleteStaging(source);
    expect(await store.head(source)).toBeNull();
    expect(Buffer.from(await (await fetch(await store.presignRead(frozen))).arrayBuffer())).toEqual(bytes);
  } finally {
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: [{ Key: source }, { Key: frozen }] } }));
    client.destroy();
  }
}, 30_000);
