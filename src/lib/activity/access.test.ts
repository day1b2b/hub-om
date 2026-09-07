import test, { mock } from "node:test";
import assert from "node:assert/strict";
const query = mock.fn(() => { throw new Error("must not query logs"); });
mock.module("@/lib/auth/apiAdminGuard", { namedExports: { denyIfNotAdmin: async () => new Response("forbidden", { status: 403 }) } });
mock.module("@/lib/data/prisma", { namedExports: { getPrismaClient: query } });
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
const { GET } = await import("@/app/api/admin/activity/route");
test("activity API checks administrator access before querying or parsing filters", async () => {
  const response = await GET(new Request("http://localhost/api/admin/activity?from=invalid"));
  assert.equal(response.status, 403);
  assert.equal(query.mock.callCount(), 0);
});

const { GET: usageGET } = await import("@/app/api/admin/activity/usage/route");
test("usage metrics deny non-admins before parsing dates or reading data", async () => {
  const response = await usageGET(new Request("http://localhost/api/admin/activity/usage?date=invalid"));
  assert.equal(response.status, 403);
  assert.equal(query.mock.callCount(), 0);
});
test("legacy history also uses the global administrator guard", async () => {
  const response = await GET(new Request("http://localhost/api/admin/activity?source=legacy"));
  assert.equal(response.status, 403);
  assert.equal(query.mock.callCount(), 0);
});
