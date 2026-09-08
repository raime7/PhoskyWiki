import { compareTermMetadata, type MetadataSnapshot } from "@/lib/revision-snapshot";

export function TermMetadataDiff({ from, to, fromLabel = "当前版", toLabel = "提案" }: { from: MetadataSnapshot; to: MetadataSnapshot; fromLabel?: string; toLabel?: string }) {
  return <div className="overflow-x-auto" data-testid="term-metadata-diff">
    <table className="w-full border-collapse text-sm">
      <thead><tr><th className="p-2 text-left">字段</th><th className="p-2 text-left">{fromLabel}</th><th className="p-2 text-left">{toLabel}</th></tr></thead>
      <tbody>{compareTermMetadata(from, to).map((row) => <tr key={row.field} data-changed={row.changed} className={row.changed ? "border-t bg-amber-500/10" : "border-t"}>
        <th className="p-2 text-left">{row.label}{row.changed ? "（已修改）" : ""}</th>
        <td className="p-2 whitespace-pre-wrap">{row.before || "（空）"}</td><td className="p-2 whitespace-pre-wrap">{row.after || "（空）"}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
