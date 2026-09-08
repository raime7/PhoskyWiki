# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: interests.spec.ts >> 登录：兴趣保存到账号并跨页持久，词条页视角按兴趣重排
- Location: tests\e2e\interests.spec.ts:173:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('session-user')
Expected substring: "编者"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for getByTestId('session-user')

```

```yaml
- banner:
  - link "PhoskyWiki":
    - /url: /
  - navigation "主导航":
    - link "词条":
      - /url: /terms
    - link "诠释者":
      - /url: /interpreters
    - link "学派":
      - /url: /schools
    - link "分类":
      - /url: /categories
    - link "图谱":
      - /url: /graph
    - link "搜索":
      - /url: /search
    - link "兴趣":
      - /url: /interests
  - combobox:
    - search:
      - textbox "全站搜索":
        - /placeholder: 搜索词条 / 诠释者 / 视角…
  - link "登录":
    - /url: /login
  - link "注册":
    - /url: /register
- main:
  - heading "注册成为编者" [level=1]
  - paragraph: 注册后可提交词条与视角的编辑，经审核受理后生效。
  - text: 名称
  - textbox "名称":
    - /placeholder: 站内展示的编者名称
    - text: 兴趣同步编者
  - text: 邮箱
  - textbox "邮箱": t12-e2e-630b0ba7-83bf-4e1a-8961-12a4a12a7192@example.com
  - text: 密码（至少 8 位）
  - textbox "密码（至少 8 位）": password123
  - alert: Too many requests. Please try again later.
  - button "注册并登录"
  - paragraph:
    - text: 已有账号？
    - link "登录":
      - /url: /login
- contentinfo: PhoskyWiki · 词条 × 视角的原子笔记 WIKI
- alert
```

# Test source

```ts
  85  |   await school.check();
  86  |   await expect.poll(async () => (await perspectiveTitles(page))[0]).toBe("拉康论主体性");
  87  |   const schoolSelection = await settings.evaluate(() => localStorage.getItem("phoskywiki:interest-tags"));
  88  |   await school.uncheck();
  89  |   await expect.poll(() => perspectiveTitles(page)).toEqual(defaultTitles);
  90  |   // storage 原生事件不会发送给写入页；应用的同页变更通知也必须能更新发现区块。
  91  |   await page.evaluate((stored) => {
  92  |     localStorage.setItem("phoskywiki:interest-tags", stored!);
  93  |     window.dispatchEvent(new Event("phoskywiki:interests-changed"));
  94  |   }, schoolSelection);
  95  |   await expect.poll(async () => (await perspectiveTitles(page))[0]).toBe("拉康论主体性");
  96  |   await page.evaluate(() => {
  97  |     localStorage.setItem("phoskywiki:interest-tags", "broken-json");
  98  |     window.dispatchEvent(new Event("phoskywiki:interests-changed"));
  99  |   });
  100 |   await expect.poll(() => perspectiveTitles(page)).toEqual(defaultTitles);
  101 |   await page.reload();
  102 |   await expect(page.getByRole("heading", { name: "主体性", level: 1 })).toBeVisible();
  103 |   await page.getByRole("button", { name: /展开全部/ }).click();
  104 |   const invalid = { v: 1, interpreters: [999999], schools: [999999], categories: [999999] };
  105 |   const invalidResponse = page.waitForResponse((response) => response.url().includes("/discovery?"));
  106 |   await page.evaluate((value) => {
  107 |     localStorage.setItem("phoskywiki:interest-tags", JSON.stringify(value));
  108 |     window.dispatchEvent(new Event("phoskywiki:interests-changed"));
  109 |   }, invalid);
  110 |   expect((await invalidResponse).status()).toBe(200);
  111 |   await expect.poll(() => perspectiveTitles(page)).toEqual(defaultTitles);
  112 |   expect(await page.getByTestId("related-terms").locator("li").allTextContents()).toEqual(defaultRelated);
  113 |   await page.route("**/discovery?**", (route) => route.abort());
  114 |   const failedRequest = page.waitForEvent("requestfailed", (request) => request.url().includes("/discovery?"));
  115 |   await school.check();
  116 |   await failedRequest;
  117 |   const chosen = await settings.evaluate(() => localStorage.getItem("phoskywiki:interest-tags"));
  118 |   await expect.poll(() => perspectiveTitles(page)).toEqual(defaultTitles);
  119 |   expect(await page.evaluate(() => localStorage.getItem("phoskywiki:interest-tags"))).toBe(chosen);
  120 |   await expect(school).toBeChecked();
  121 |   await page.unroute("**/discovery?**");
  122 |   await page.reload();
  123 |   await expect.poll(async () => (await perspectiveTitles(page))[0]).toBe("拉康论主体性");
  124 | });
  125 | 
  126 | test("浏览器拒绝 localStorage 时仍可阅读并保留本页选择", async ({ page }) => {
  127 |   await page.addInitScript(() => {
  128 |     Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
  129 |   });
  130 |   await gotoSubjectivity(page);
  131 |   await expect(page.getByTestId("related-terms")).toBeVisible();
  132 |   await page.goto("/interests");
  133 |   await page.getByLabel("德勒兹", { exact: true }).check();
  134 |   await expect(page.getByLabel("德勒兹", { exact: true })).toBeChecked();
  135 |   await expect(page.getByRole("status")).toContainText("浏览器无法保存兴趣");
  136 | });
  137 | 
  138 | test("游客：选择兴趣即存本浏览器，词条页视角按兴趣重排", async ({ page }) => {
  139 |   await gotoSubjectivity(page);
  140 | 
  141 |   // 默认序（未设兴趣）：唯一被站内引用的 阿尔都塞论主体性 在首位，拉康不在首位
  142 |   await expect.poll(() => perspectiveTitles(page)).toContain("拉康论主体性");
  143 |   const before = await perspectiveTitles(page);
  144 |   expect(before[0]).not.toBe("拉康论主体性");
  145 | 
  146 |   // 相关词条区块：游客按共同引用强度（异化 10 > 意识形态 8 > 剩余价值 2 > 价值（哲学）1）
  147 |   const related = page.getByTestId("related-terms");
  148 |   await expect(related).toBeVisible();
  149 |   await expect(related).toContainText("异化");
  150 |   await expect(related).toContainText("意识形态");
  151 |   await expect(related.locator("li").first()).toContainText("异化");
  152 |   // 游客无兴趣：不出现兴趣匹配徽标
  153 |   await expect(page.getByTestId("interest-match-badge")).toHaveCount(0);
  154 | 
  155 |   await page.goto("/interests");
  156 |   await page.getByLabel("拉康", { exact: true }).check();
  157 | 
  158 |   // localStorage 已写入（游客路径不落服务端）
  159 |   const stored = await page.evaluate(() =>
  160 |     window.localStorage.getItem("phoskywiki:interest-tags"),
  161 |   );
  162 |   expect(stored).not.toBeNull();
  163 |   expect(JSON.parse(stored!).interpreters).toHaveLength(1);
  164 | 
  165 |   await gotoSubjectivity(page);
  166 |   // 水合后重排：拉康论主体性 升到首位，其余保持默认序，并出现提示
  167 |   await expect
  168 |     .poll(() => perspectiveTitles(page))
  169 |     .toEqual(["拉康论主体性", ...before.filter((title) => title !== "拉康论主体性")]);
  170 |   await expect(page.getByTestId("interest-reorder-hint")).toBeVisible();
  171 | });
  172 | 
  173 | test("登录：兴趣保存到账号并跨页持久，词条页视角按兴趣重排", async ({ page }) => {
  174 |   // 注册前先以游客视角记录默认序（独立上下文，无本地兴趣）
  175 |   await gotoSubjectivity(page);
  176 |   await expect.poll(() => perspectiveTitles(page)).toContain("德勒兹论主体性");
  177 |   const before = await perspectiveTitles(page);
  178 | 
  179 |   const email = `t12-e2e-${randomUUID()}@example.com`;
  180 |   await page.goto("/register");
  181 |   await page.getByLabel("名称").fill("兴趣同步编者");
  182 |   await page.getByLabel("邮箱").fill(email);
  183 |   await page.getByLabel("密码（至少 8 位）").fill("password123");
  184 |   await page.getByRole("button", { name: "注册并登录" }).click();
> 185 |   await expect(page.getByTestId("session-user")).toContainText("编者");
      |                                                  ^ Error: expect(locator).toContainText(expected) failed
  186 | 
  187 |   await page.goto("/interests");
  188 |   await page.getByLabel("德勒兹", { exact: true }).check();
  189 |   await page.getByRole("button", { name: "保存到账号" }).click();
  190 |   await expect(page.getByTestId("interest-saved")).toBeVisible();
  191 | 
  192 |   // 服务端持久：整页重开仍勾选
  193 |   await page.goto("/interests");
  194 |   await expect(page.getByLabel("德勒兹", { exact: true })).toBeChecked();
  195 | 
  196 |   // 个人主页展示当前兴趣
  197 |   await page.goto("/profile");
  198 |   await expect(page.getByTestId("profile-interest-chips")).toContainText("德勒兹");
  199 | 
  200 |   // 登录路径：SSR 即重排（无需等水合），德勒兹论主体性 升到首位
  201 |   await gotoSubjectivity(page);
  202 |   await expect
  203 |     .poll(() => perspectiveTitles(page))
  204 |     .toEqual(["德勒兹论主体性", ...before.filter((title) => title !== "德勒兹论主体性")]);
  205 |   await expect(page.getByTestId("interest-reorder-hint")).toBeVisible();
  206 | });
  207 | 
```