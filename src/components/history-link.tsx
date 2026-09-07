import Link from "next/link";

export function HistoryLink({ pageId }: { pageId: number }) {
  return <Link href={`/history/${pageId}`} className="inline-block py-2 text-sm text-muted-foreground underline-offset-4 hover:underline">修订历史</Link>;
}
