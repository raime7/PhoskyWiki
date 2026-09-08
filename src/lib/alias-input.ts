/** Commas delimit items; quoted items use string escapes to preserve every character in a text input. */
export function formatAliasInput(aliases: readonly string[]): string {
  return aliases.map(alias => /[,，"\\]/.test(alias) || [...alias].some(character => character.charCodeAt(0) < 32) || alias.trim() !== alias
    ? JSON.stringify(alias)
    : alias).join(",");
}

type ParsedAliases = { aliases: string[]; error?: never } | { aliases?: never; error: string };
const separator = /[,，\r\n]/;
const invalidQuotes = "别名引号格式不完整：含逗号的单个别名请用英文双引号包住，如 \"Alpha, Beta\"；引号或反斜杠需加反斜杠转义。草稿已保留。";

export function parseAliasInput(input: string): ParsedAliases {
  const aliases: string[] = [];
  let offset = 0;
  while (offset < input.length) {
    while (offset < input.length && /[\s,，]/.test(input[offset])) offset++;
    if (offset === input.length) break;
    let value: string;
    if (input[offset] === '"') {
      const start = offset++;
      let closed = false;
      while (offset < input.length) {
        if (input[offset] === "\\") { offset += 2; continue; }
        if (input[offset++] === '"') { closed = true; break; }
      }
      if (!closed) return { error: invalidQuotes };
      try { value = JSON.parse(input.slice(start, offset)) as string; }
      catch { return { error: invalidQuotes }; }
      while (offset < input.length && /[ \t]/.test(input[offset])) offset++;
      if (offset < input.length && !separator.test(input[offset])) return { error: invalidQuotes };
    } else {
      const start = offset;
      while (offset < input.length && !separator.test(input[offset])) offset++;
      value = input.slice(start, offset).trim();
      if (value.includes('"')) return { error: invalidQuotes };
    }
    if (value.trim()) aliases.push(value);
  }
  return { aliases };
}
