// 中文 AI 腔清单（validate 的 style.ai-pattern 提示，ADR-0009）。
//
// 这里是唯一的清单：只收能用正则可靠认出的套话与句式，命中只是提示，不阻断（ok 不受影响），
// 由 submit 列入提交说明。判断性的模式（三连排比、总-分套路、句长划一、翻译腔）留给润色子代理，
// 规则见技能 source-to-concepts 的 references/humanizer.md。
// 匹配对象是解读与一句话核心的可见文字（引用块之外）；同一论点的各块合并计数。

export interface StylePattern {
  /** 报告里显示的名称 */
  label: string;
  /** 须带 g 标志 */
  pattern: RegExp;
  /** 同一论点内命中次数达到它才提示（套话为 1；对举、破折号这类单用无妨的取更高值） */
  min: number;
  advice: string;
}

const CLAUSE = "[^。！？；\\n]";

export const AI_PATTERNS: readonly StylePattern[] = [
  { label: "值得注意的是", pattern: /值得(?:注意|一提|关注|强调)的是/g, min: 1, advice: "套话：删去，直接陈述要点" },
  { label: "需要指出的是", pattern: /需要(?:指出|说明|强调)的是/g, min: 1, advice: "套话：删去，直接陈述要点" },
  { label: "不难看出", pattern: /不难(?:看出|发现|理解|想见)|显而易见|毋庸置疑|毫无疑问|无可否认|不言而喻|无疑/g, min: 1, advice: "空洞的确定性：删去；是否成立由摘录说明" },
  { label: "总而言之", pattern: /总而言之|总的来说|综上所述|由此可见/g, min: 1, advice: "公式化收束：删去总结句，或只保留新信息" },
  { label: "可以说", pattern: /可以说(?![明服])|可以这么说|(?:在|从)?某种(?:意义|程度)上(?:说)?|在一定程度上/g, min: 1, advice: "含糊的限定：删去，或说清在什么意义上" },
  {
    label: "深刻地揭示",
    pattern: /深刻地?(?:揭示|阐明|指出|洞察|剖析|批判|反思)|深刻(?:的)?洞见|振聋发聩|鞭辟入里|精辟地?|意味深长|耐人寻味|发人深省/g,
    min: 1,
    advice: "评价性修饰，也违背“不评价”：去掉修饰，只说诠释者说了什么",
  },
  {
    label: "至关重要",
    pattern: /至关重要|不可或缺|举足轻重|意义深远|具有(?:重要|深远|重大)的?(?:意义|影响)|发挥(?:着)?(?:重要|关键)的?作用|起到了?(?:重要|关键|积极)的?作用|占据(?:着)?(?:重要|核心|中心|关键)的?地位/g,
    min: 1,
    advice: "空洞的强调：说出具体起什么作用，或删去",
  },
  { label: "有效地", pattern: /有效地(?:防止|避免|解决|化解|回应|揭示|说明|区分)/g, min: 1, advice: "空洞的效果宣称：删去“有效地”，只说做了什么" },
  { label: "……所在", pattern: /(?:精髓|关键|核心|意义|奥秘)所在/g, min: 1, advice: "空洞的强调：直接说是什么" },
  {
    label: "提供了视角",
    pattern: /(?:提供|开辟|打开)了(?:一个|一种|一条)?(?:全新|独特|新|重要)?的?(?:视角|框架|路径|思路|维度)/g,
    min: 1,
    advice: "AI 腔总结：改为陈述具体内容",
  },
  { label: "进行深入分析", pattern: /进行了?(?:深入|系统|全面|细致)的?(?:分析|探讨|论述|阐述|考察)/g, min: 1, advice: "虚动词加修饰：直接用动词（“分析了……”）" },
  { label: "让我们", pattern: /让我们|我们不妨|我们可以看到/g, min: 1, advice: "解读的主语是诠释者，不对读者喊话" },
  { label: "不仅仅是……更是", pattern: new RegExp(`不仅仅?是${CLAUSE}{1,40}?更是`, "g"), min: 1, advice: "递进套式：直接陈述后一项，或拆成两句" },
  {
    label: "不是……而是",
    pattern: new RegExp(`不是${CLAUSE}{1,40}?而是`, "g"),
    min: 2,
    advice: "反射式对举：只在纠正确有的误读时用一次，其余正面陈述",
  },
  { label: "首先……其次……最后", pattern: /首先[\s\S]{0,400}?其次[\s\S]{0,400}?(?:最后|再次)/g, min: 1, advice: "公式化铺排：按论证本身的次序写" },
  { label: "破折号", pattern: /——/g, min: 3, advice: "破折号过多：改成逗号、句号，或拆句" },
];

export interface StyleHit {
  label: string;
  count: number;
  advice: string;
}

/** 一段可见文字中达到阈值的命中，按清单顺序。 */
export function aiPatternHits(text: string): StyleHit[] {
  const hits: StyleHit[] = [];
  for (const { label, pattern, min, advice } of AI_PATTERNS) {
    const count = text.match(pattern)?.length ?? 0;
    if (count >= min) hits.push({ label, count, advice });
  }
  return hits;
}
