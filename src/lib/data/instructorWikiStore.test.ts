import assert from "node:assert/strict";
import { test } from "node:test";

import { notionIdKey, resolveNotionLinkTargets } from "@/lib/data/instructorWikiStore.ts";

const ID_A = "6e94576d6ffa832981c88119396fa1c5";
const ID_B = "ead4576d6ffa832a860601227e12dba8";

test("노션 ID는 대시·URL 형태를 벗겨 32자 hex로 맞춘다", () => {
  assert.equal(notionIdKey(ID_A), ID_A);
  assert.equal(notionIdKey("6e94576d-6ffa-8329-81c8-8119396fa1c5"), ID_A);
  assert.equal(notionIdKey(`https://www.notion.so/${ID_A}`), ID_A);
  assert.equal(notionIdKey(undefined), "");
  assert.equal(notionIdKey("연결안됨"), "");
});

test("다른 노트를 가리키는 notionId만 수동 연결로 본다", () => {
  const targets = resolveNotionLinkTargets({
    // 동기화가 만든 본체(자기 페이지 ID를 가짐)
    김진태: { notionId: ID_A, notion: { syncedAt: "2026-08-20T00:00:00.000Z" } },
    // OM이 연결한 운영 현황 표기
    "디노랩스_김진태": { notionId: ID_A },
    // 연결 안 된 표기
    강완주: {}
  });

  assert.deepEqual(targets, { "디노랩스_김진태": "김진태" });
});

test("본체 자신은 연결 대상에서 빠진다", () => {
  const targets = resolveNotionLinkTargets({
    김진태: { notionId: ID_A, notion: { syncedAt: "x" } }
  });
  assert.deepEqual(targets, {});
});

test("가리키는 대상이 없는 notionId는 무시한다", () => {
  const targets = resolveNotionLinkTargets({
    김진태: { notionId: ID_A, notion: { syncedAt: "x" } },
    떠돌이표기: { notionId: ID_B }
  });
  assert.deepEqual(targets, {});
});

test("같은 노션 ID를 두 노트가 가지면 syncedAt이 최신인 쪽을 정본으로 본다", () => {
  // 예전에 연결하면서 스냅샷까지 복사된 경우. 동기화가 갱신하는 본체가 최신이다.
  const targets = resolveNotionLinkTargets({
    "디노랩스_김진태": { notionId: ID_A, notion: { syncedAt: "2026-07-01T00:00:00.000Z" } },
    김진태: { notionId: ID_A, notion: { syncedAt: "2026-08-20T00:00:00.000Z" } }
  });
  assert.deepEqual(targets, { "디노랩스_김진태": "김진태" });
});

test("syncedAt이 같으면 이름이 짧은 쪽을 정본으로 본다(결정적)", () => {
  const same = "2026-08-20T00:00:00.000Z";
  const targets = resolveNotionLinkTargets({
    "디노랩스_김진태": { notionId: ID_A, notion: { syncedAt: same } },
    김진태: { notionId: ID_A, notion: { syncedAt: same } }
  });
  assert.deepEqual(targets, { "디노랩스_김진태": "김진태" });

  // 키 순서를 바꿔도 결과가 같아야 한다.
  const reversed = resolveNotionLinkTargets({
    김진태: { notionId: ID_A, notion: { syncedAt: same } },
    "디노랩스_김진태": { notionId: ID_A, notion: { syncedAt: same } }
  });
  assert.deepEqual(reversed, targets);
});
