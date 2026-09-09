/** Runs before fixtures that truncate content; never infer a test target from .env. */
export function assertIsolatedTestEnvironment() {
  const database = process.env.DATABASE_URL;
  const url = database ? new URL(database) : null;
  if (!url || !["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.search || url.hash || !decodeURIComponent(url.pathname).endsWith("_test")) {
    throw new Error("Tests require an explicit DATABASE_URL ending in _test; see docs/production.md");
  }
  const bucket = process.env.R2_CONTRACT_BUCKET;
  if (bucket && (!bucket.endsWith("-test") || bucket === process.env.R2_BUCKET)) {
    throw new Error("R2 contract tests require a separate *-test bucket");
  }
  // App-side tests use object-store fakes. Never inherit live R2 credentials.
  // Empty overrides also stop next dev/start from filling them back from .env.
  for (const key of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) process.env[key] = "";
  process.env.MEILI_INDEX_UID = "pages-test";
}
