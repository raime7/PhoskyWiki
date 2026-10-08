// 提交说明（submissions.note）：提交者附给审核者的纯文本。
// 只按纯文本显示（React 转义，保留换行），不做 Markdown/HTML 渲染。
// 审核队列里条目多，长说明默认折叠成一行预览；提交详情页总是全文展开。

const PREVIEW_CHARS = 120;
const PREVIEW_LINES = 4;

function preview(note: string): string {
  const firstLine = note.split("\n", 1)[0];
  return firstLine.length > PREVIEW_CHARS ? `${firstLine.slice(0, PREVIEW_CHARS)}…` : firstLine;
}

export function SubmissionNote({ note, collapseLong = false, className = "" }: { note: string; collapseLong?: boolean; className?: string }) {
  const long = note.length > PREVIEW_CHARS || note.split("\n").length > PREVIEW_LINES;
  const body = <p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{note}</p>;
  return (
    <section aria-label="提交说明" data-testid="submission-note" className={`rounded-md border border-border bg-muted/40 p-3 text-sm ${className}`}>
      {collapseLong && long ? (
        <details data-testid="submission-note-collapsible">
          <summary className="min-h-11 cursor-pointer py-1">
            <span className="font-medium">提交说明</span>
            <span className="text-muted-foreground">（{note.length} 字，展开全文）</span>
            <span className="mt-1 block break-words text-muted-foreground [overflow-wrap:anywhere]">{preview(note)}</span>
          </summary>
          {body}
        </details>
      ) : (
        <>
          <p className="font-medium">提交说明</p>
          {body}
        </>
      )}
    </section>
  );
}
