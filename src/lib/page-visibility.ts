import "server-only";

import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/** 所有公开入口的页面可见性：视角自身、所属词条、诠释者都必须在线。
 * 独立子查询避免各入口的 join/别名不同而漏掉父级；不改写任何删除标记或关系。
 */
export function isPageVisible(pageId: SQLWrapper): SQL<boolean> {
  return sql<boolean>`${pageId} in (
    select visible_page.id from pages visible_page
    left join perspectives visible_perspective on visible_perspective.page_id = visible_page.id
    left join pages visible_term on visible_term.id = visible_perspective.term_id
    left join pages visible_interpreter on visible_interpreter.id = visible_perspective.interpreter_id
    where visible_page.deleted_at is null and (
      visible_page.type <> 'perspective' or (
        visible_term.id is not null and visible_term.deleted_at is null
        and visible_interpreter.id is not null and visible_interpreter.deleted_at is null
      )
    )
  )`;
}
