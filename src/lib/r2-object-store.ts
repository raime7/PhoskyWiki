import "server-only";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStore } from "./object-store";

export interface R2Config { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string }
export function r2ObjectStore(config: R2Config): ObjectStore {
  const client = new S3Client({ endpoint: config.endpoint, region: "auto", credentials: config, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  const Bucket = config.bucket;
  return {
    async deleteStaging(Key) {
      if (!/^staging\/[0-9a-f-]{36}$/.test(Key)) throw new Error("INVALID_STAGING_KEY");
      await client.send(new DeleteObjectCommand({ Bucket, Key }), { abortSignal: AbortSignal.timeout(15000) });
    },
    async presignUpload(Key, contentType) {
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket, Key, ContentType: contentType }), { expiresIn: 300, signableHeaders: new Set(["content-type"]) });
      return { url, headers: { "Content-Type": contentType } };
    },
    async head(Key) {
      try {
        const value = await client.send(new HeadObjectCommand({ Bucket, Key }), { abortSignal: AbortSignal.timeout(15000) });
        return { size: value.ContentLength ?? 0, contentType: value.ContentType ?? "", etag: value.ETag ?? "" };
      } catch (err) {
        if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
    async copy(source, Key, etag) {
      await client.send(new CopyObjectCommand({ Bucket, Key, CopySource: `${Bucket}/${source.split("/").map(encodeURIComponent).join("/")}`, CopySourceIfMatch: etag }));
    },
    presignRead(Key) { return getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), { expiresIn: 60 }); },
  };
}
