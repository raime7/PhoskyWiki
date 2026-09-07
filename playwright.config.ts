import { defineConfig, devices } from "@playwright/test";

// 本地可用 PW_PORT 换端口起被测服务器（例如同机并行跑多份检出时避免占用 3000）
const PORT = Number(process.env.PW_PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

// 默认用 Playwright 自带 Chromium；本地可用 PW_CHANNEL=chrome 复用系统浏览器，免去下载
const channel = process.env.PW_CHANNEL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  // 本地 dev server（按需编译）扛不住多 worker 并发首编译，T11 种子扩容后尤甚；
  // CI 走产物服务器，保持默认并行
  workers: process.env.CI ? undefined : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    channel,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // CI 用产物服务器（前置 build），本地默认起 dev server；已有服务器则复用
    command: process.env.CI ? "pnpm start" : `pnpm dev --port ${PORT}`,
    url: `${baseURL}/`,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    timeout: 120_000,
  },
});
