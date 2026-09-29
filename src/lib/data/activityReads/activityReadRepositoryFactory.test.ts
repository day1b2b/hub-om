import assert from "node:assert/strict";
import { test } from "node:test";
import { runWithDataRepositories } from "../dataRepositoryContext";
import { getActivityReadRepository } from "./activityReadRepositoryFactory";
import { PrismaActivityReadRepository } from "./prismaActivityReadRepository";
import { activityQuery } from "../../activity/query";
import { feedQuery } from "../../activity/feed";
import { usageFilters } from "../../activity/usage";

test("activity read factory keeps PG default and scopes never reach the default database", async () => {
  assert.ok(getActivityReadRepository() instanceof PrismaActivityReadRepository);
  await Promise.all([new PrismaActivityReadRepository(), new PrismaActivityReadRepository()].map(activityReads => runWithDataRepositories({ activityReads }, async () => {
    await Promise.resolve(); assert.equal(getActivityReadRepository(), activityReads);
    runWithDataRepositories({}, () => assert.throws(getActivityReadRepository, /DATA_REPOSITORY_NOT_CONFIGURED: activityReads/));
    assert.equal(getActivityReadRepository(), activityReads);
    const repo = new PrismaActivityReadRepository();
    const now = new Date("2090-01-01T00:00:00Z");
    for (const work of [() => repo.adminList(activityQuery(new URLSearchParams())), () => repo.legacyList(null),
      () => repo.feed(feedQuery(new URLSearchParams(), now)), () => repo.usage(usageFilters("2090-01-01", now))]) {
      await assert.rejects(work(), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
    }
  })));
  assert.ok(getActivityReadRepository() instanceof PrismaActivityReadRepository);
});
