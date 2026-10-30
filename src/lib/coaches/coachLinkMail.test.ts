import assert from "node:assert/strict";
import test from "node:test";
import { buildCoachLinkMailBody, buildCoachLinkMailUrl, latestLinkMailPerCoach, LINK_MAIL_SUBJECT, shortActorName } from "./coachLinkMail";

test("mail body greets the coach by name and carries the personal link on its own line", () => {
  const body = buildCoachLinkMailBody("강은서", "https://hub-om.skillflo.app/coach?token=abc");
  const lines = body.split("\n");
  assert.equal(lines[0], "안녕하세요, 강은서 코치님.");
  assert.ok(lines.includes("https://hub-om.skillflo.app/coach?token=abc"));
  assert.equal(lines.at(-1), "감사합니다 :)");
});

test("gmail compose url round-trips recipient, subject and body including the token query", () => {
  const link = "https://hub-om.skillflo.app/coach?token=a&b=1";
  const url = new URL(buildCoachLinkMailUrl({ to: "coach@example.com", coachName: "강은서", link }));
  assert.equal(url.origin + url.pathname, "https://mail.google.com/mail/");
  assert.equal(url.searchParams.get("view"), "cm");
  assert.equal(url.searchParams.get("to"), "coach@example.com");
  assert.equal(url.searchParams.get("su"), LINK_MAIL_SUBJECT);
  assert.ok(url.searchParams.get("body")?.includes(link));
});

test("only the newest log per coach is kept, in the given newest-first order", () => {
  const rows = [
    { coachId: "a", accessedAt: new Date("2026-10-30T05:00:00Z"), accessedByEmail: "late@x.kr" },
    { coachId: "b", accessedAt: new Date("2026-10-30T04:00:00Z"), accessedByEmail: null },
    { coachId: "a", accessedAt: new Date("2026-10-29T05:00:00Z"), accessedByEmail: "early@x.kr" }
  ];
  assert.deepEqual(latestLinkMailPerCoach(rows), [
    { coachId: "a", at: "2026-10-30T05:00:00.000Z", byEmail: "late@x.kr" },
    { coachId: "b", at: "2026-10-30T04:00:00.000Z", byEmail: null }
  ]);
});

test("actor names keep only the local part of an email", () => {
  assert.equal(shortActorName("yj.lee@day1company.co.kr"), "yj.lee");
  assert.equal(shortActorName(null), "-");
  assert.equal(shortActorName(""), "-");
});
