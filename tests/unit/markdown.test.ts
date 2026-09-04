import { describe, expect, it } from "vitest";

import { renderMarkdown, type ResolveWikiLink } from "@/lib/markdown";

// 典型解析器：已存在的两个词条 + 其余一律红链
const resolve: ResolveWikiLink = (name) =>
  name === "主体性"
    ? { href: "/term/主体性-1", exists: true }
    : name === "异化"
      ? { href: "/term/异化-4", exists: true }
      : { href: "", exists: false };

describe("renderMarkdown", () => {
  it("默认双链渲染为落词条枢纽的站内链接", () => {
    const html = renderMarkdown("参见 [[主体性]]。", resolve);
    expect(html).toContain(
      '<a class="wiki-link" href="/term/主体性-1">主体性</a>',
    );
  });

  it("未创建词条渲染为红链（span + 提示，无可点击 href）", () => {
    const html = renderMarkdown("缺口见 [[镜像阶段]]。", resolve);
    expect(html).toContain(
      '<span class="wiki-link wiki-link--red" title="词条尚未创建">镜像阶段</span>',
    );
    expect(html).not.toMatch(/href="[^"]*镜像阶段/);
  });

  it("中文词条名与别名显示正常工作", () => {
    const html = renderMarkdown("[[异化]]，或 [[主体性|主体的地位]]。", resolve);
    expect(html).toContain('href="/term/异化-4">异化</a>');
    expect(html).toContain('<a class="wiki-link" href="/term/主体性-1">主体的地位</a>');
  });

  it("基础 Markdown 元素正常渲染", () => {
    const html = renderMarkdown("## 标题\n\n段落**加粗**与 `code`。", resolve);
    expect(html).toContain("<h2>标题</h2>");
    expect(html).toContain("<strong>加粗</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("HTML 直写被 sanitize 剥除（内容只信 Markdown）", () => {
    const html = renderMarkdown(
      '<script>alert(1)</script><img src=x onerror=alert(1)>',
      resolve,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });

  it("链接注入的原始 HTML href 不被渲染为站内链接", () => {
    const html = renderMarkdown(
      '<a href="https://evil.example">钓鱼</a>',
      resolve,
    );
    expect(html).not.toContain("evil.example");
  });
});
