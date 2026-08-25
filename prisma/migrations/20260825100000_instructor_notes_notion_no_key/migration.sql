-- 강사위키 연결 키를 강사명 → 노션 ID(NO)로 바꾼다.
--
-- 강사명은 노션에서 바뀔 수 있고, 동명이인(같은 이름의 서로 다른 강사)이 실제로 있다.
-- 예: 노션 강사 DB의 "김준범"이 NO=185와 NO=746 두 행으로 존재한다.
-- 이름을 unique 키로 두면 이 둘이 한 행을 공유하게 되어 서로의 값을 덮어쓴다.
--
-- 그래서 notion_no를 추가해 unique로 두고, instructor_name의 unique는 일반 index로 낮춘다.
-- 노션에 없는 강사(운영현황 표기만 있는 행)는 notion_no가 NULL이며, PostgreSQL의 unique는
-- NULL을 중복으로 보지 않으므로 여러 행이 공존할 수 있다.

ALTER TABLE "instructor_notes" ADD COLUMN "notion_no" INTEGER;

-- 이름 unique 제거 → 조회용 index로 대체.
-- (제약 이름이 환경에 따라 다를 수 있어 존재할 때만 지운다.)
DROP INDEX IF EXISTS "instructor_notes_instructor_name_key";
ALTER TABLE "instructor_notes" DROP CONSTRAINT IF EXISTS "instructor_notes_instructor_name_key";

CREATE UNIQUE INDEX "instructor_notes_notion_no_key" ON "instructor_notes"("notion_no");
CREATE INDEX "instructor_notes_instructor_name_idx" ON "instructor_notes"("instructor_name");
