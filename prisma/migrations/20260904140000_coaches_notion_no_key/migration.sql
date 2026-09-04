-- 노션 코치(실습코치/운영조교) 연동 키를 이름 → 노션 "No ID"(auto increment, 예: CH-51)로 바꾼다.
--
-- 이름은 노션에서 바뀔 수 있고 동명이인(같은 이름의 서로 다른 코치)이 있을 수 있다.
-- 이름으로만 매칭하면 두 사람이 한 행을 공유해 서로의 값을 덮어쓴다.
-- 강사(instructor_notes.notion_no, 20260825100000)와 같은 방식이다.
--
-- 노션에 없는 코치(계약시트로만 들어온 행)는 notion_no가 NULL이며, PostgreSQL의 unique는
-- NULL을 중복으로 보지 않으므로 여러 행이 공존할 수 있다.
-- 기존 행의 notion_no는 첫 동기화가 이름으로 찾아 채운다(별도 backfill 스크립트 없음).

ALTER TABLE "coaches" ADD COLUMN "notion_no" INTEGER;

CREATE UNIQUE INDEX "coaches_notion_no_key" ON "coaches"("notion_no");
