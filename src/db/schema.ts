// Drizzle schema：PhoskyWiki 的全部表定义都收敛在这里。
// 数据模型见 ADR-0003「统一页面壳与 id 寻址」：
//   - pages 是所有可寻址页面的统一壳，修订/软删除/双链一律挂 page_id；
//   - 每类页面的专有字段放独立负载表（class-table inheritance），FK 到 pages.id；
//   - URL = /<type>/<slug>-<id>，id 永不改变，改名只换 slug。
// schools / disambiguation 的负载表随各自工单落地（消歧义页不单独建模，见 ADR-0003 #6）。

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const pageTypeEnum = pgEnum("page_type", [
  "term",
  "perspective",
  "interpreter",
  "school",
  "disambiguation",
] as const);

export type PageType = (typeof pageTypeEnum.enumValues)[number];

/** 页面统一壳：一切可寻址内容（词条/视角/诠释者/学派/消歧义）都在这里有一行。 */
export const pages = pgTable(
  "pages",
  {
    id: serial("id").primaryKey(),
    type: pageTypeEnum("type").notNull(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    // 软删除标记；null = 在线。内容与历史全保留，恢复 = 清除标记（ADR-0003 #7）
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // 编者 users.id；users 表随认证工单落地后补外键
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 双链按名称解析，要求词条标题全局唯一（ADR-0003 #5）；同名多义用括号限定标题
    uniqueIndex("pages_term_title_unique")
      .on(t.title)
      .where(sql`type = 'term'`),
    index("pages_type_idx").on(t.type),
  ],
);

/** 词条负载表：概念名的聚合枢纽页，知识内容存于其下的视角。 */
export const terms = pgTable("terms", {
  pageId: integer("page_id")
    .primaryKey()
    .references(() => pages.id, { onDelete: "cascade" }),
  // 一句话简介，词条页信息框与列表用；正文知识在视角里
  summary: text("summary").notNull().default(""),
  // 别名一期仅信息框展示，不参与双链解析（ADR-0003 #5）
  aliases: text("aliases")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
});

/** 诠释者负载表：给出诠释的思想家（如拉康），不是页面的撰写者。 */
export const interpreters = pgTable("interpreters", {
  pageId: integer("page_id")
    .primaryKey()
    .references(() => pages.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
  birthYear: integer("birth_year"),
  deathYear: integer("death_year"),
  // 编委会：以站方名义发布通俗解读的特殊诠释者，其视角固定排第一
  isEditorialBoard: boolean("is_editorial_board").notNull().default(false),
});

/** 视角负载表：「诠释者 × 词条」的一次完整诠释，站内的原子知识单位。 */
export const perspectives = pgTable(
  "perspectives",
  {
    pageId: integer("page_id")
      .primaryKey()
      .references(() => pages.id, { onDelete: "cascade" }),
    termId: integer("term_id")
      .notNull()
      .references(() => terms.pageId, { onDelete: "cascade" }),
    interpreterId: integer("interpreter_id")
      .notNull()
      .references(() => interpreters.pageId, { onDelete: "cascade" }),
  },
  // 同一诠释者对同一词条只有一个视角
  (t) => [uniqueIndex("perspectives_term_interpreter_unique").on(t.termId, t.interpreterId)],
);

/** 修订：每次受理/直编/回滚产生的全量内容快照（ADR-0004 #7/#9）。 */
export const revisions = pgTable(
  "revisions",
  {
    id: serial("id").primaryKey(),
    pageId: integer("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    // Markdown 源文本，全量存储；diff 是展示期产物，不落库（ADR-0004）
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("revisions_page_idx").on(t.pageId, t.id)],
);

/**
 * 双链：source → target，保存（受理产生修订）时解析落库（ADR-0003 #4）。
 * 目标页不存在则 target_page_id 为空、保留 target_name 文本快照——即红链；
 * 「写作缺口」视图 = target 为空的聚合，反链/图谱/热度排序共用本表。
 */
export const links = pgTable(
  "links",
  {
    id: serial("id").primaryKey(),
    sourcePageId: integer("source_page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    targetPageId: integer("target_page_id").references(() => pages.id, {
      onDelete: "cascade",
    }),
    targetName: text("target_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 同一页面对同名目标只落一条
    uniqueIndex("links_source_name_unique").on(t.sourcePageId, t.targetName),
    index("links_target_idx").on(t.targetPageId),
  ],
);
