-- 최신 dev의 결과보고서 필드는 유지하고 개인정보 값은 변경 여부만 기록한다.
-- 기존 migration은 수정하지 않는다. 운영 반영은 책임자 검토/백업/점검 중단 후 수행한다.
DROP TRIGGER IF EXISTS activity_change ON om_requests;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON om_requests
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["status", "operation_id", "team", "company", "training_type", "course_id", "course_name", "course_category_major", "course_category", "skillflo_setup", "skillmatch_setup", "onsite_operation", "coach_request", "result_report_needed", "total_sessions"]');
