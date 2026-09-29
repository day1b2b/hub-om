import assert from "node:assert/strict";
import { test } from "node:test";
import { runWithDataRepositories } from "../dataRepositoryContext";
import { getAnnouncementRepository } from "./announcementRepositoryFactory";
import { PrismaAnnouncementRepository } from "./prismaAnnouncementRepository";

test("announcement factory keeps PG defaults and isolated scopes never reach default PG", async () => {
  assert.ok(getAnnouncementRepository() instanceof PrismaAnnouncementRepository);
  const left = new PrismaAnnouncementRepository(), right = new PrismaAnnouncementRepository();
  await Promise.all([left, right].map(announcements => runWithDataRepositories({ announcements }, async () => {
    await Promise.resolve();
    assert.equal(getAnnouncementRepository(), announcements);
    runWithDataRepositories({}, () => assert.throws(getAnnouncementRepository, /DATA_REPOSITORY_NOT_CONFIGURED: announcements/));
    assert.equal(getAnnouncementRepository(), announcements);
    const pg = new PrismaAnnouncementRepository(), id = "aaaaaaaa-0000-4000-8000-000000000001";
    for (const call of [
      () => pg.list(), () => pg.getDetail(id), () => pg.getDetailPage(id), () => pg.getEditPage(id),
      () => pg.getUpdateState(id), () => pg.getDeleteState(id), () => pg.download(id, id),
      () => pg.create({ title: "Synthetic", content: "Synthetic", authorEmail: "synthetic@example.invalid", authorName: null, attachments: [] }),
      () => pg.update({ id, title: "Synthetic", content: "Synthetic", attachments: [], removeAttachmentIds: [] }),
      () => pg.softDelete(id, null)
    ]) await assert.rejects(call(), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
  })));
  assert.ok(getAnnouncementRepository() instanceof PrismaAnnouncementRepository);
});
