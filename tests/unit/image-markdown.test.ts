import { expect, it } from "vitest";
import { imageReferences } from "@/lib/image-markdown";
import { renderMarkdown } from "@/lib/markdown";

const id = "b9f1f442-4a89-4f35-8a1b-86145e7e166c";
it("仅允许规范的站内图片地址，内联与引用式图片使用同一校验", () => {
  expect(imageReferences(`![说明](/api/images/${id})`)).toEqual([id]);
  expect(imageReferences(`![说明][图]\n\n[图]: /api/images/${id}`)).toEqual([id]);
  for (const source of ["![x](https://evil.test/x.png)", "![x](//evil.test/x)", "![x][图]\n\n[图]: https://evil.test/x", "<img src='https://evil.test/x'>", "![x](/api/images/../../evil)", "![x](data:image/png;base64,AAAA)"]) {
    expect(() => imageReferences(source)).toThrow();
    expect(renderMarkdown(source, () => ({ href: "", exists: false }))).not.toContain("<img");
  }
  expect(imageReferences("`![x](https://example.com)`\n\n```\n<img src='x'>\n```" )).toEqual([]);
});
