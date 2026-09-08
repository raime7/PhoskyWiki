审查范围：`855285b5be39d1dc8aafeef31a6c0a77d1e08905...a935c6243c75bd6ed006d4be957b6720df2bad1b`。后续 `e5907c0` 仅删除测试 EOF 空行，不影响以下结论。未改产品代码、未执行数据库操作。

文档标准：未确认新增的硬性违规。已按 CONTEXT、ADR-0001～0004、TECH-STACK、一期 Spec 与 #18 Testing Decisions 检查；数据库夹具准备与公开 HTTP/DOM 结果断言分别看待，未把生成文件或工具保证项列为发现。

- **[P2] 可能的 Primitive Obsession / Duplicated Code（判断性发现）：别名数组在表单中失去元素边界。** `src/components/submission-form.tsx:80` 的 `aliases.join(",")` / `aliases.join("、")` 将结构化列表压成无转义字符串；`:158` 的 `aliases.split(/[、，,\n]/)` 与 `:167` 的 `aliases.split(/[，,\n]/)` 又复制了不同的还原规则。具体后果：现有新建 UI 输入 `甲、乙` 可保存为 `["甲、乙"]`，此后打开词条编辑，只修改简介再提交，别名就变成 `["甲","乙"]`；通过 API/导入保存的 `["Alpha, Beta"]` 在驳回重提时也被拆开。纯表达式复现已确认该转换；新增 `tests/unit/revision-snapshot.test.ts:4` 本身也明确区分这些别名边界。建议表单与草稿保留数组，以逐项编辑或可逆编码处理输入，并让新建、编辑、重提共用同一转换。

Standards：1 项判断性发现，最高 P2；硬性标准违规 0 项。
