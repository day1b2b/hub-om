-- 강사위키 OM 입력값 + 노션 강사 DB 스냅샷 보관 테이블.
-- 신규 테이블만 추가한다. 기존 테이블/컬럼 변경이나 데이터 삭제는 없다.
--
-- 연락처·이메일·생년월일은 개인정보라 컬럼을 두지 않는다.
-- 해당 값은 로컬(.local/instructor-wiki.json, gitignore)에만 남기고 DB로 옮기지 않는다.
-- notion_profile(JSONB)에도 들어가지 않도록 적재 전에 src/lib/data/instructorNotePii.ts가 걷어낸다.
CREATE TABLE "instructor_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "instructor_name" TEXT NOT NULL,
    "display_name" TEXT,
    "notion_id" TEXT,
    "partner_id" TEXT,
    "notes" TEXT,
    "recruit_avoid" BOOLEAN NOT NULL DEFAULT false,
    "notion_profile" JSONB,
    "notion_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instructor_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "instructor_notes_instructor_name_key" ON "instructor_notes"("instructor_name");

CREATE INDEX "instructor_notes_recruit_avoid_idx" ON "instructor_notes"("recruit_avoid");
