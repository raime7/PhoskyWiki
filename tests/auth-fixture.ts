import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../src/db";
import { accessGrants } from "../src/db/schema";
import { assertIsolatedTestEnvironment } from "./isolated-environment";

/** Fixture preparation only; never imported by production modules. */
export async function invitationFixture() {
  assertIsolatedTestEnvironment();
  const token = randomBytes(32).toString("base64url");
  await getDb().insert(accessGrants).values({ purpose: "invitation", digest: createHash("sha256").update(`invitation:${token}`).digest("hex"), expiresAt: new Date(Date.now() + 3600000) });
  return token;
}
