import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Normal suites always clear application storage credentials. Only this explicit
// real-service entrypoint passes independent contract credentials to the server.
const { R2_CONTRACT_ENDPOINT, R2_CONTRACT_BUCKET, R2_CONTRACT_ACCESS_KEY_ID, R2_CONTRACT_SECRET_ACCESS_KEY } = process.env;
if (!R2_CONTRACT_ENDPOINT || !R2_CONTRACT_BUCKET?.endsWith("-test") || !R2_CONTRACT_ACCESS_KEY_ID || !R2_CONTRACT_SECRET_ACCESS_KEY) {
  throw new Error("Real R2 browser tests require explicit R2_CONTRACT_* credentials and an independent *-test bucket");
}
export default defineConfig({
  ...base, testDir: "./tests/r2", workers: 1, fullyParallel: false, retries: 0, timeout: 120000,
  use: { ...base.use, trace: "off", screenshot: "off", video: "off" },
  webServer: { ...base.webServer, command: `pnpm dev --port ${process.env.PW_PORT ?? 3000}`,
    env: { R2_ENDPOINT: R2_CONTRACT_ENDPOINT, R2_BUCKET: R2_CONTRACT_BUCKET,
      R2_ACCESS_KEY_ID: R2_CONTRACT_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: R2_CONTRACT_SECRET_ACCESS_KEY },
  },
});
