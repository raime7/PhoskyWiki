// PROTOTYPE：切换条与服务端共享的变体表（一次性代码）。
export const PROTO_COOKIE = "pw-proto-variant";
export const PROTO_VARIANTS = [
  { key: "current", label: "现状" },
  { key: "book", label: "书卷" },
  { key: "middle", label: "居中" },
  { key: "poster", label: "海报" },
] as const;
export type ProtoVariant = (typeof PROTO_VARIANTS)[number]["key"];
