-- "결과보고서 여부"를 회차(operation_sessions)뿐 아니라 과정(courses) 레벨에도 둔다. PM 지시:
-- 회차마다 값이 다르면 과정 전체를 하나의 상태로 승격한다(규칙은
-- docs/operations/course-level-result-report-status-backfill.md 참고). 과정 레벨 값이 아직
-- 없는(승격 전) 과정을 구분해야 해서 회차 레벨과 달리 기본값 없이 nullable로 둔다.
-- 기존 operation_sessions.has_result_report는 이번 마이그레이션에서 건드리지 않는다
-- (회차별 값은 그대로 유지, 별도 cleanup PR 대상). 백필은 scripts/promote-result-report-status.ts로 별도 실행한다.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "courses" ADD COLUMN "has_result_report" "result_report_status";

-- activity_change 트리거의 courses 추적 필드 목록에도 새 컬럼을 반영한다
-- (20260907090000_activity_logs에서 만든 트리거를 같은 필드 목록 + 새 컬럼으로 재생성).
DROP TRIGGER IF EXISTS activity_change ON courses;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON courses
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["company_id", "course_id", "course_name", "operation_type", "course_category", "revenue", "has_result_report"]');

COMMIT;
