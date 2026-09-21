-- om-request 접수 화면에 "결과보고서" Y/N 항목을 추가한다. 기존 요청 건은
-- 값이 없었으므로 기본값 'N'으로 채운다.
ALTER TABLE "om_requests" ADD COLUMN "result_report_needed" TEXT NOT NULL DEFAULT 'N';

-- activity_change 트리거의 om_requests 추적 필드 목록에도 새 컬럼을 반영한다
-- (20260907090000_activity_logs에서 만든 트리거를 같은 필드 목록 + 새 컬럼으로 재생성).
DROP TRIGGER IF EXISTS activity_change ON om_requests;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON om_requests
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["status", "assigned_om", "ld_email", "operation_id", "team", "ld", "company", "training_type", "course_id", "course_name", "course_category_major", "course_category", "instructor_name", "skillflo_setup", "skillmatch_setup", "onsite_operation", "coach_request", "result_report_needed", "total_sessions"]');
