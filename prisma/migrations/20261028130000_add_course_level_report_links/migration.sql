-- 결과보고서/강의관리 링크·메모를 회차(operation_sessions)뿐 아니라 과정(courses) 레벨에도 둔다.
-- 과정 상세에서 회차마다 반복 입력하던 두 항목을 과정당 1개로 통합하기 위한 expand 단계이며,
-- 기존 operation_sessions의 동일 컬럼은 이번 마이그레이션에서 건드리지 않는다(별도 cleanup PR 대상).
-- 전부 nullable, 기본값 없음, 기존 row는 전혀 바뀌지 않는다(백필은 scripts/backfill-course-level-report-links.ts로 별도 실행).
-- result_report_link/lecture_management_link/lecture_management_note는 operation_sessions의 동일 필드와 같이
-- 앱 레벨 암호화 대상(src/lib/privacy/fields.json)이라 짝이 되는 *_pii_index 컬럼도 함께 추가한다.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "courses"
  ADD COLUMN "result_report_link" TEXT,
  ADD COLUMN "lecture_management_link" TEXT,
  ADD COLUMN "lecture_management_note" TEXT,
  ADD COLUMN "result_report_link_pii_index" TEXT,
  ADD COLUMN "lecture_management_link_pii_index" TEXT,
  ADD COLUMN "lecture_management_note_pii_index" TEXT;

COMMIT;
