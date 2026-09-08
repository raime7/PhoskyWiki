import assert from "node:assert/strict";

if (!process.env.DATABASE_URL?.endsWith("/phosky_spec18_legacyupgrade")) throw new Error("Dedicated upgrade database required");
const route = await import("../../src/app/api/pages/[pageId]/history/route.ts");
const response = await (route.GET ?? route.default.GET)(
  new Request("http://localhost/api/pages/90001/history"),
  { params: Promise.resolve({ pageId: "90001" }) },
);
assert.equal(response.status, 200);
const history = await response.json();
assert.equal(history.revisions.length, 3);
assert.equal(history.revisions[0].source, "baseline");
assert.deepEqual(history.revisions[0].snapshot, {
  version: 1, type: "term", title: "Legacy upgrade term",
  summary: "Actual summary before migration", aliases: ["Known alias", "Second alias"],
});
assert.deepEqual(history.revisions.slice(1).map(({ content, snapshot, source }) => ({ content, snapshot, source })), [
  { content: "Old revision B must remain unchanged", snapshot: null, source: "legacy" },
  { content: "Old revision A has no recoverable metadata", snapshot: null, source: "legacy" },
]);
console.log(JSON.stringify({ status: "passed", seam: "GET /api/pages/90001/history", revisions: history.revisions.length, baseline: history.revisions[0].snapshot, legacySnapshots: "unchanged and explicitly unrecoverable" }));
process.exit(0);
