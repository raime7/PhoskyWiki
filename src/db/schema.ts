// Drizzle schema：PhoskyWiki 的全部表定义都收敛在这里。
// 数据模型见 ADR-0003「统一页面壳与 id 寻址」：
//   - pages 是所有可寻址页面的统一壳，修订/软删除/双链一律挂 page_id；
//   - 每类页面的专有字段放独立负载表（class-table inheritance），FK 到 pages.id；
//   - URL = /<type>/<slug>-<id>，id 永不改变，改名只换 slug。
// 消歧义的负载表随各自工单落地（不单独建模，见 ADR-0003 #6）。
//
// 强弱类型边界（CONTEXT.md）：学派是强类型实体只组织诠释者，分类是弱类型标签树只组织
// 词条。边界落在 schema 层——school_members.interpreter_id 只能指向 interpreters 负载表，
// term_categories.term_id 只能指向 terms 负载表；反向挂载违反外键被数据库拒绝。
// 学派「核心词条」不设挂载表：由成员视角聚合派生（content.ts），挂词条在 schema 上即不可能。

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
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
    // 编者 user.id（better-auth 文本 id，T05）
    createdBy: text("created_by").references(() => user.id),
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
    // 编者置顶标记：null = 未置顶；置顶时间即标记时间（管理员可置顶/取消，T04）
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  },
  // 同一诠释者对同一词条只有一个视角
  (t) => [uniqueIndex("perspectives_term_interpreter_unique").on(t.termId, t.interpreterId)],
);

/** 学派负载表：诠释者的分组导航实体（如法兰克福学派），强类型，只组织诠释者。 */
export const schools = pgTable("schools", {
  pageId: integer("page_id")
    .primaryKey()
    .references(() => pages.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
});

/**
 * 学派成员：强类型边界所在——interpreter_id 只指向 interpreters 负载表，
 * 把词条/视角/学派挂入学派在 schema 层即被外键拒绝。
 */
export const schoolMembers = pgTable(
  "school_members",
  {
    schoolId: integer("school_id")
      .notNull()
      .references(() => schools.pageId, { onDelete: "cascade" }),
    interpreterId: integer("interpreter_id")
      .notNull()
      .references(() => interpreters.pageId, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ name: "school_members_pk", columns: [t.schoolId, t.interpreterId] }),
    index("school_members_interpreter_idx").on(t.interpreterId),
  ],
);

/**
 * 分类：萌百式弱类型标签树，只组织词条（知识主题），一期不是页面类型——
 * 无修订、无讨论、无软删除，分类树浏览是功能页而非实体页（ADR-0003 #2）。
 * name 即身份（寻址用 slug），parentId 自引用成树，根分类 parentId 为空。
 */
export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    parentId: integer("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    uniqueIndex("categories_name_unique").on(t.name),
    uniqueIndex("categories_slug_unique").on(t.slug),
    index("categories_parent_idx").on(t.parentId),
  ],
);

/**
 * 词条挂分类：弱类型边界的镜像——term_id 只指向 terms 负载表，
 * 把诠释者挂入分类在 schema 层即被外键拒绝。一个词条可挂多个分类。
 */
export const termCategories = pgTable(
  "term_categories",
  {
    termId: integer("term_id")
      .notNull()
      .references(() => terms.pageId, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ name: "term_categories_pk", columns: [t.termId, t.categoryId] }),
    index("term_categories_category_idx").on(t.categoryId),
  ],
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

// ---------------------------------------------------------------------------
// 认证与角色（T05）：better-auth 邮箱密码 + 数据库会话。
// 表结构按 better-auth 的约定字段建模（src/lib/auth.ts 的 drizzleAdapter 指向这里），
// 应用自有字段只有 user.role（additionalFields 声明，input:false 客户端不可写）。
// ---------------------------------------------------------------------------

/**
 * 角色枚举（spec「Implementation Decisions」）：editor 编者 / admin 管理员。
 * trusted 为二期「免审编者晋级层」的预留扩展位——枚举先落库，业务语义随该工单再实现。
 * 「游客」不是数据库角色：未登录即游客，无 user 行。
 */
export const userRoleEnum = pgEnum("user_role", ["editor", "admin", "trusted"] as const);

export type UserRole = (typeof userRoleEnum.enumValues)[number];

/** 编者/管理员账号。注册即 editor；管理员由种子或既有管理员指定。 */
export const user = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRoleEnum("role").notNull().default("editor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** 数据库会话（better-auth）：httpOnly cookie 存 token，服务端查本表。 */
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("session_token_unique").on(t.token),
    index("session_user_idx").on(t.userId),
  ],
);

/**
 * 认证账号表：邮箱密码登录时 providerId = "credential"、password 存散列，
 * 结构同时兼容将来的 OAuth provider（一期不用）。
 */
export const account = pgTable(
  "account",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    // better-auth 1.7 的账号命名空间：本地凭据为 "local:credential"，OAuth 为其 issuer
    issuer: text("issuer").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("account_provider_account_unique").on(t.providerId, t.accountId),
    index("account_user_idx").on(t.userId),
  ],
);

/** 验证令牌（邮箱验证等，一期仅注册流程占位使用）。 */
export const verification = pgTable(
  "verification",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
