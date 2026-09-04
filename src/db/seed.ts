// 种子数据：读路径的第一批演示内容（T02 验收：≥3 词条、≥3 诠释者、≥4 视角，
// 含编委会通俗视角、跨词条双链、红链）。
//
// seedDatabase() 幂等：TRUNCATE 全部内容表后按固定顺序重插（serial 因此确定），
// 集成测试与 e2e 共用这一份 fixture。生产环境不该跑它。

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { interpreters, links, pages, perspectives, revisions, terms } from "@/db/schema";
import { slugify } from "@/lib/slug";
import { extractWikiLinks } from "@/lib/wiki-links";

interface SeedTerm {
  title: string;
  aliases: string[];
  summary: string;
}

interface SeedInterpreter {
  name: string;
  summary: string;
  birthYear?: number;
  deathYear?: number;
  isEditorialBoard?: boolean;
}

interface SeedPerspective {
  term: string;
  interpreter: string;
  content: string;
}

const SEED_TERMS: SeedTerm[] = [
  {
    title: "主体性",
    aliases: ["主体", "subject"],
    summary:
      "「谁在思考、在行动」——这个看似最自明的问题，在各家体系里得到完全不同的回答。",
  },
  {
    title: "意识形态",
    aliases: ["观念形态", "ideology"],
    summary:
      "意义系统还是虚假意识？一个社会如何把个体制造为「自然」地服从的主体。",
  },
  {
    title: "异化",
    aliases: ["外化", "Entfremdung"],
    summary:
      "人造的世界反过来支配人：劳动产品、关系与本质如何成为敌对的力量。",
  },
  {
    title: "剩余价值",
    aliases: ["Mehrwert"],
    summary:
      "工人创造的价值超过其劳动力价格的部分——不等价的占有藏身于等价交换之中。",
  },
];

const SEED_INTERPRETERS: SeedInterpreter[] = [
  {
    name: "编委会",
    summary:
      "PhoskyWiki 以站方名义发布通俗解读的特殊诠释者；每个词条的第一个视角固定为编委会的通俗视角。",
    isEditorialBoard: true,
  },
  {
    name: "拉康",
    summary:
      "法国精神分析学家（1901–1981），以「回到弗洛伊德」之名重写精神分析：无意识像语言一样被结构，主体在能指链中被构成。",
    birthYear: 1901,
    deathYear: 1981,
  },
  {
    name: "阿尔都塞",
    summary:
      "法国马克思主义哲学家（1918–1990），结构马克思主义的代表：意识形态询唤主体，历史是「无主体的过程」。",
    birthYear: 1918,
    deathYear: 1990,
  },
  {
    name: "马克思",
    summary:
      "德国哲学家与革命家（1818–1883），政治经济学批判的创立者：剩余价值、异化劳动与历史唯物主义。",
    birthYear: 1818,
    deathYear: 1883,
  },
  {
    name: "黑格尔",
    summary:
      "德国观念论哲学家（1770–1831），以《精神现象学》与《逻辑学》构建主体—实体的辩证体系。",
    birthYear: 1770,
    deathYear: 1831,
  },
  {
    name: "福柯",
    summary:
      "法国哲学家（1926–1984），知识考古学与系谱学：主体是权力/知识配置的历史效果。",
    birthYear: 1926,
    deathYear: 1984,
  },
  {
    name: "德勒兹",
    summary:
      "法国哲学家（1925–1995），与加塔利合著《反俄狄浦斯》：欲望机器、生成、差异的形而上学。",
    birthYear: 1925,
    deathYear: 1995,
  },
];

const SEED_PERSPECTIVES: SeedPerspective[] = [
  {
    term: "主体性",
    interpreter: "编委会",
    content: `「主体性」问的是一个看起来最简单的问题：谁是「我」？当你思考、选择、说出「我认为」的时候，那个发出动作的「我」究竟是什么？

在日常生活中，我们默认有一个稳定、自主、理性的自我在指挥一切。但哲学史的不断冲击让这个默认变得可疑：康德把主体变成了认识的框架而非知识的对象；马克思说人的本质在其现实性上是一切社会关系的总和；弗洛伊德与拉康则把「我」赶下了自我指挥台，发现语言与无意识早在「我」开口之前就在说话。

因此，「主体性」在本站不是一个有标准答案的词条，而是一个枢纽：你可以从[[意识形态]]看权力如何塑造主体，从[[异化]]看劳动如何颠倒主体与对象的关系，也可以进入各位诠释者的视角，看「主体」在他们的体系里分别指什么。

读完通俗视角后，建议按兴趣选择下方视角继续深入。`,
  },
  {
    term: "主体性",
    interpreter: "拉康",
    content: `拉康的名言「无意识像语言一样被结构」意味着：主体不是先于语言的存在，而是在能指链中被构成的。婴儿在镜像阶段（约六到十八个月）把镜中的完整影像认作「自己」，从此以一个「他者的形象」来想象自身的统一——主体在起源处就是一个误认。

进入象征界后，主体进一步被大他者（语言与法的秩序）所询唤，「我」只是能指链上不断滑动的效果。因此拉康的主体是分裂的主体：言说的「我」永远无法与被言说的「我」重合。

在意识形态问题上，拉康的框架后来被阿尔都塞借用：意识形态把个体询唤为主体，正是一种镜像式的误认。可参照[[意识形态]]词条下阿尔都塞的视角；主体与对象颠倒的问题亦见[[异化]]。若想看[[镜像阶段]]作为独立概念的展开，该词条尚待撰写——这是一个写作缺口。`,
  },
  {
    term: "主体性",
    interpreter: "阿尔都塞",
    content: `阿尔都塞认为，「主体」从来不是给定的，而是意识形态机器的产品：当一个警察喊「嘿，你！」而你回头时，你已经被询唤为主体——接受了你在社会秩序中的位置。

主体性因此是一种双重的镜像结构：个体把自己认作自由的主体，恰恰是在服从的时刻。自由感是意识形态的最高效果。

这一论点直接改造了拉康的镜像阶段，也把[[意识形态]]从「虚假意识」重新定义为物质实践。与之对照，马克思在[[异化]]中对主体颠倒的描述仍停留在「本真自我可以被恢复」的期待上，阿尔都塞则认为主体之外无出口——只有作为过程的科学与政治实践。`,
  },
  {
    term: "主体性",
    interpreter: "黑格尔",
    content: `黑格尔的主体不是笛卡尔式的静止实体，而是自我运动的过程：主体只有在与它对立的对象世界中劳作、斗争、承受否定，才能返回自身并认出对象是「自己的他者」。

《精神现象学》中的主奴辩证法是这一运动的经典场景：两个自我意识生死相搏，胜者成为奴役中的「主人」却依赖奴隶的劳动确认自身；奴隶在劳动中改造对象，反而率先成长为真正的主体。

绝对精神的体系最终承诺：主体与实体、自我与世界在概念中达成和解。这个「和解」被后世不断攻击——马克思把它翻转到物质生产（见[[异化]]），拉康则宣布主体在语言中的分裂不可弥合。`,
  },
  {
    term: "主体性",
    interpreter: "马克思",
    content: `马克思对「主体是谁」的回答藏在《关于费尔巴哈的提纲》第六条：人的本质不是单个人所固有的抽象物，在其现实性上，它是一切社会关系的总和。主体性不是天赋，而是社会历史的产物。

更重要的是主体性的历史形态：在资本主义生产方式下，自由平等的「法律主体」恰恰是商品交换的人格化——市场面前人人平等，工厂之内服从分工。抽象的主体平等掩盖了具体的支配。

因此马克思不谈「一般主体」，而谈阶级主体：无产阶级之所以是历史的主体，不因为它贫困，而因为它的劳动就是社会本身，推翻[[异化]]的劳动条件即改造社会本身。经济机制的概念另见[[剩余价值]]。`,
  },
  {
    term: "主体性",
    interpreter: "福柯",
    content: `福柯拒绝「主体是什么」的提问方式，转问「主体如何被制造」：疯人、病人、囚犯、性变态——每个身份都是特定知识/权力配置在身体上刻下的效果。

规训技术（时间表、考核、全景敞视监狱）把身体塑造为「驯顺而有用的」力量；主体性不是被压抑的本真内核，而是权力关系的产物。权力不在主体之上，而在主体之中。

晚年福柯转向「自我技术」：主体如何通过对自我的劳作构成自身。这与拉康「主体在能指中被构成」的路径构成对照，也与[[意识形态]]的询唤理论互为参照。[[规训]]作为独立词条尚待撰写。`,
  },
  {
    term: "主体性",
    interpreter: "德勒兹",
    content: `德勒兹用「个体化」取代「主体」：真正的哲学形象不是「我思」，而是欲望生产着的身体与机器。主体不是出发点，而是欲望机器运作中的一个剩余效果——如同泡沫之于酿造。

与拉康的「欲望是缺乏」相反，德勒兹与加塔利主张欲望是生产：它连接、断开、流动，不围绕任何中心。主体因此应当被「稀释」为一条在强度中变动的线。

在这一视野下，把主体视为可异化又可复归的本真单位（如某些对[[异化]]的读法）恰恰是偶像崇拜；政治的任务不是恢复主体，而是释放生成。`,
  },
  {
    term: "意识形态",
    interpreter: "编委会",
    content: `「意识形态」在日常语汇里约等于「偏见」或「宣传」，但在思想史里它是争论最激烈的概念之一：它可以是扭曲现实的虚假观念，也可以是任何社会都必需的意义系统。

本词条聚合各家的用法：马克思传统里的意识形态批判、阿尔都塞的「意识形态没有历史」、以及与之相关的[[主体性]]生产问题。一个方便的入口是问三个问题：谁在言说？这套观念维持了谁的处境？拒绝它的人如何生活？

通俗视角只给坐标，不给结论——各家分歧正是本站要展示的东西。`,
  },
  {
    term: "意识形态",
    interpreter: "阿尔都塞",
    content: `阿尔都塞的《意识形态和意识形态国家机器》做出四个论断：意识形态没有历史；意识形态是个人与其生存条件的想象关系的「表象」；意识形态具有物质的存在（仪式、机构、实践）；意识形态把个体询唤为主体。

最后一论断把问题从「观念真伪」转移到「主体生产」：教堂、学校、家庭、媒体等意识形态国家机器日复一日地把个体制造为「自由主体」。详见[[主体性]]词条下本诠释者的视角。

意识形态因此是「永恒的」——不存在无意识形态的社会，能改变的只是其形态。这与把意识形态视为可用科学彻底清除的幻象（某种启蒙立场）构成尖锐对立，也与[[异化]]的「复归本真」想象分道扬镳。`,
  },
  {
    term: "异化",
    interpreter: "编委会",
    content: `「异化」描述的是这样一种经验：人造物的世界反过来支配人本身——劳动的产品成为敌对的力量，人与人的关系变成物与物的关系。

这个词的谱系很长：从社会契约论者笔下「让渡权利」的技术用法，经黑格尔与费尔巴哈的哲学化，到马克思《1844 年经济学哲学手稿》的劳动异化四规定，再到二十世纪的社会批判理论。本词条下的视角呈现其中最关键的几站。

入门读者可把它与[[主体性]]对读：异化理论都预设了某种「本可以不异化」的主体概念——这恰恰是后来者（如阿尔都塞，见[[意识形态]]）攻击最猛烈的地方。`,
  },
  {
    term: "异化",
    interpreter: "马克思",
    content: `《1844 年经济学哲学手稿》给出劳动异化的四重规定：劳动者同劳动产品相异化（产品属于资本家）；同劳动活动相异化（劳动是被迫的、外在的）；同类本质相异化（自由自觉的活动本是人的类特性）；人与人相异化（一切关系被交换中介）。

在成熟期的《资本论》里，「异化」的术语退居幕后，分析让位于[[剩余价值]]的剥削机制——商品拜物教一节描述的「物与物的关系掩盖人与人的关系」，可视为异化理论在政治经济学批判中的完成形态。

争论在于：异化是否预设了一个本真的类本质？阿尔都塞后来主张根本不存在这样的「人本主义」主体——见[[意识形态]]词条。黑格尔的原始版本则见本词条另一视角。`,
  },
  {
    term: "异化",
    interpreter: "黑格尔",
    content: `在《精神现象学》里，异化（Entfremdung）是精神的必经环节：意识把自己的本质外化为对象，又在对象中认出自己，从而上升为更高的意识形态。异化不是灾难，而是劳动与中介的结构本身。

主奴辩证法再次成为样板：奴隶在恐惧中劳动，把意志外化为物；正因为对象是他自己的作品，他得以在对象中直观自身——参见[[主体性]]词条的展开。

因此黑格尔的异化内含和解的承诺：外化必被扬弃。马克思后来质问：如果外化不是意识的自我运动，而是特定生产关系下的实际处境呢？见本词条之马克思视角。`,
  },
  {
    term: "剩余价值",
    interpreter: "编委会",
    content: `「剩余价值」是马克思政治经济学批判的核心：工人创造的价值超过其劳动力价格的部分，被资本无偿占有。它是利润、地租与利息的共同源泉。

把这一概念与日常的「剥削」直觉区分开的关键在于：剩余价值不需要欺诈——等价交换的市场上照样发生。资本家按价值购买劳动力（付工资），而劳动力是一种特殊商品：它的使用（劳动）本身就能创造出大于自身价值的价值。

本词条当前只有通俗视角，具体展开（不变资本与可变资本、绝对剩余价值与相对剩余价值、资本有机构成）尚待撰写。相关概念见[[异化]]与[[主体性]]。`,
  },
];

/** 清空内容表并重灌种子数据。返回计数摘要。 */
export async function seedDatabase(): Promise<{
  terms: number;
  interpreters: number;
  perspectives: number;
  links: { resolved: number; red: number };
}> {
  const db = getDb();
  await db.execute(
    sql`truncate table ${links}, ${revisions}, ${perspectives}, ${interpreters}, ${terms}, ${pages} restart identity cascade`,
  );

  // 词条与诠释者：pages 壳 + 负载表
  const termIds = new Map<string, number>();
  for (const term of SEED_TERMS) {
    const [page] = await db
      .insert(pages)
      .values({ type: "term", title: term.title, slug: slugify(term.title) })
      .returning({ id: pages.id });
    await db
      .insert(terms)
      .values({ pageId: page.id, summary: term.summary, aliases: term.aliases });
    termIds.set(term.title, page.id);
  }

  const interpreterIds = new Map<string, number>();
  for (const interpreter of SEED_INTERPRETERS) {
    const [page] = await db
      .insert(pages)
      .values({
        type: "interpreter",
        title: interpreter.name,
        slug: slugify(interpreter.name),
      })
      .returning({ id: pages.id });
    await db.insert(interpreters).values({
      pageId: page.id,
      summary: interpreter.summary,
      birthYear: interpreter.birthYear ?? null,
      deathYear: interpreter.deathYear ?? null,
      isEditorialBoard: interpreter.isEditorialBoard ?? false,
    });
    interpreterIds.set(interpreter.name, page.id);
  }

  // 视角：pages 壳 + 负载表 + 首个修订（受理产生修订的种子等价物）+ links 落库
  let resolvedLinks = 0;
  let redLinks = 0;
  for (const perspective of SEED_PERSPECTIVES) {
    const termId = termIds.get(perspective.term)!;
    const interpreterId = interpreterIds.get(perspective.interpreter)!;
    const title = `${perspective.interpreter}论${perspective.term}`;
    const [page] = await db
      .insert(pages)
      .values({ type: "perspective", title, slug: slugify(title) })
      .returning({ id: pages.id });
    await db
      .insert(perspectives)
      .values({ pageId: page.id, termId, interpreterId });
    await db.insert(revisions).values({ pageId: page.id, content: perspective.content });

    // 保存时解析（ADR-0003 #4）：目标存在落 page_id，不存在留名称快照（红链）
    for (const name of extractWikiLinks(perspective.content)) {
      const targetId = termIds.get(name) ?? null;
      if (targetId) resolvedLinks += 1;
      else redLinks += 1;
      await db
        .insert(links)
        .values({ sourcePageId: page.id, targetPageId: targetId, targetName: name });
    }
  }

  return {
    terms: SEED_TERMS.length,
    interpreters: SEED_INTERPRETERS.length,
    perspectives: SEED_PERSPECTIVES.length,
    links: { resolved: resolvedLinks, red: redLinks },
  };
}
