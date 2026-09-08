import type { ObjectMetadata, ObjectStore } from "@/lib/object-store";

export class FakeObjectStore implements ObjectStore {
  private objects = new Map<string, ObjectMetadata>();
  async presignUpload(key: string, contentType: string) { return { url: `https://objects.test/${key}`, headers: { "Content-Type": contentType } }; }
  /** 模拟浏览器 PUT，测试只在外部系统边界提供输入。 */
  upload(url: string, size: number, contentType = "image/png") {
    this.objects.set(new URL(url).pathname.slice(1), { size, contentType, etag: `${size}-${Math.random()}` });
  }
  async head(key: string) { return this.objects.get(key) ?? null; }
  async copy(source: string, destination: string, etag: string) {
    const value = this.objects.get(source);
    if (!value || value.etag !== etag) throw new Error("Object changed");
    this.objects.set(destination, { ...value });
  }
  async presignRead(key: string) { return `https://objects.test/${key}?read=1`; }
}
