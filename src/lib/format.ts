// 展示层的小型格式化纯函数（无 IO、无 React 耦合）。

/** 生卒年展示：两端缺省用 '?' 占位，全缺省返回 '—'。 */
export function formatYears(
  birth?: number | null,
  death?: number | null,
): string {
  if (birth == null && death == null) return "—";
  return `${birth ?? "?"}–${death ?? "?"}`;
}

/**
 * 站内时间戳展示（修订、通知、讨论楼层）。固定 Asia/Shanghai 时区：
 * 这些时间都在服务端渲染，不钉死时区会随部署环境漂移。
 */
export function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(date);
}
