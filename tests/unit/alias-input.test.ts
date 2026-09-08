import { expect, it } from "vitest";
import { formatAliasInput, parseAliasInput } from "@/lib/alias-input";

it("统一处理中英文逗号、空项和空白，顿号保留在单个别名中", () => {
  expect(parseAliasInput(' 甲、乙, Alpha Beta ， , \n 乙 , "" ')).toEqual({ aliases: ["甲、乙", "Alpha Beta", "乙"] });
});

it("引号保护分隔符，转义保护引号、反斜杠、换行和前后空白", () => {
  expect(parseAliasInput(String.raw`"Alpha, Beta","中文，逗号","引号 \"示例\"","路径\\名称","换行\n别名","  保留空白  "`)).toEqual({ aliases: ["Alpha, Beta", "中文，逗号", '引号 "示例"', "路径\\名称", "换行\n别名", "  保留空白  "] });
  expect(formatAliasInput(["甲、乙", "Alpha, Beta", '引号 "示例"', "路径\\名称", "换行\n别名", "  保留空白  "])).toBe(String.raw`甲、乙,"Alpha, Beta","引号 \"示例\"","路径\\名称","换行\n别名","  保留空白  "`);
});

it.each(['"未闭合', '"甲"尾缀', '不完整"引号', String.raw`"错误\q转义"`, '"双引号""未分隔"'])("含糊引号 %s 明确报错，不猜测数组边界", input => {
  expect(parseAliasInput(input)).toEqual({ error: expect.stringContaining("引号格式不完整") });
});

it("制表符与其他控制字符也能经单行文本安全往返", () => {
  const aliases = ["制表\t符", "回车\r符", "退格\b符", "换页\f符"];
  expect(formatAliasInput(aliases)).toBe(String.raw`"制表\t符","回车\r符","退格\b符","换页\f符"`);
  expect(parseAliasInput(String.raw`"制表\t符","回车\r符","退格\b符","换页\f符"`)).toEqual({ aliases });
});
