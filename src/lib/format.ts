// 展示层的小型格式化纯函数（无 IO、无 React 耦合）。

/** 生卒年展示：两端缺省用 '?' 占位，全缺省返回 '—'。 */
export function formatYears(
  birth?: number | null,
  death?: number | null,
): string {
  if (birth == null && death == null) return "—";
  return `${birth ?? "?"}–${death ?? "?"}`;
}
