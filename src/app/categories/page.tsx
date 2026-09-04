import type { Metadata } from "next";
import Link from "next/link";

import type { CategoryTreeNode } from "@/lib/categories";
import { categoryPath } from "@/lib/categories";
import { getCategoryTree } from "@/lib/content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "分类 · PhoskyWiki" };

function CategoryTreeNodeItem({ node }: { node: CategoryTreeNode }) {
  return (
    <li>
      <Link
        href={categoryPath(node.slug)}
        className="font-medium underline-offset-4 hover:underline"
      >
        {node.name}
      </Link>
      <span className="ml-2 text-xs text-muted-foreground">
        {node.termCount} 个词条
      </span>
      {node.children.length > 0 && (
        <ul className="mt-2 ml-4 space-y-2 border-l border-border pl-4">
          {node.children.map((child) => (
            <CategoryTreeNodeItem key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function countNodes(nodes: CategoryTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

export default async function CategoriesPage() {
  const tree = await getCategoryTree();
  const total = countNodes(tree);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight">分类</h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">
        弱类型标签树，只用于组织词条的知识主题——一个词条可同时挂在多个分类下；
        与学派不同，分类不组织诠释者。
      </p>

      <section aria-labelledby="tree-heading" className="mt-10">
        <h2 id="tree-heading" className="mb-6 text-xl font-semibold">
          分类树（{total}）
        </h2>
        {tree.length > 0 ? (
          <ul className="space-y-3 rounded-lg border border-border bg-card p-5">
            {tree.map((root) => (
              <CategoryTreeNodeItem key={root.id} node={root} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            暂无分类。本地开发可运行 <code>pnpm db:seed</code> 灌入演示内容。
          </p>
        )}
      </section>
    </main>
  );
}
