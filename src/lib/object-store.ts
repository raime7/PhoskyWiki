import "server-only";
import { r2ObjectStore } from "./r2-object-store";
import { ImageError } from "./image-markdown";

export interface ObjectMetadata { size: number; contentType: string; etag: string }
/** 图片字节仅在浏览器与对象存储间流动，应用只签名、查询与冻结对象。 */
export interface ObjectStore {
  presignUpload(key: string, contentType: string): Promise<{ url: string; headers: Record<string, string> }>;
  head(key: string): Promise<ObjectMetadata | null>;
  copy(source: string, destination: string, etag: string): Promise<void>;
  presignRead(key: string): Promise<string>;
  deleteStaging(key: string): Promise<void>;
}
let injected: ObjectStore | undefined;
export function injectObjectStore(store: ObjectStore | undefined) { injected = store; }
export function getObjectStore(): ObjectStore {
  if (injected) return injected;
  const { R2_ENDPOINT: endpoint, R2_BUCKET: bucket, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new ImageError(503, "图片存储尚未配置，请联系管理员");
  return r2ObjectStore({ endpoint, bucket, accessKeyId, secretAccessKey });
}
