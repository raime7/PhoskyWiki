// 书籍流水线的运行错误：消息以 `CODE: …` 开头，cli.ts 原样打印并以退出码 1 结束（见 README「退出码」）。

export function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}
