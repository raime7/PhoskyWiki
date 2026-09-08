# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: resubmission.spec.ts >> 驳回词条从详情完整预填、网络失败保留独立草稿、重提两票公开
- Location: tests\e2e\resubmission.spec.ts:6:5

# Error details

```
Test timeout of 120000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - banner [ref=e2]:
    - generic [ref=e3]:
      - link "PhoskyWiki" [ref=e4] [cursor=pointer]:
        - /url: /
      - navigation "主导航" [ref=e5]:
        - link "词条" [ref=e6] [cursor=pointer]:
          - /url: /terms
        - link "诠释者" [ref=e7] [cursor=pointer]:
          - /url: /interpreters
        - link "学派" [ref=e8] [cursor=pointer]:
          - /url: /schools
        - link "分类" [ref=e9] [cursor=pointer]:
          - /url: /categories
        - link "图谱" [ref=e10] [cursor=pointer]:
          - /url: /graph
        - link "搜索" [ref=e11] [cursor=pointer]:
          - /url: /search
        - link "兴趣" [ref=e12] [cursor=pointer]:
          - /url: /interests
      - combobox [ref=e14]:
        - search [ref=e15]:
          - textbox "全站搜索" [ref=e16]:
            - /placeholder: 搜索词条 / 诠释者 / 视角…
      - generic [ref=e17]:
        - link "登录" [ref=e18] [cursor=pointer]:
          - /url: /login
        - link "注册" [ref=e19] [cursor=pointer]:
          - /url: /register
  - main [ref=e21]:
    - heading "审核队列" [level=1] [ref=e22]
    - paragraph [ref=e23]: 只有管理员可以查看审核队列与受理/驳回提交。
  - contentinfo [ref=e24]: PhoskyWiki · 词条 × 视角的原子笔记 WIKI
  - alert [ref=e25]
```