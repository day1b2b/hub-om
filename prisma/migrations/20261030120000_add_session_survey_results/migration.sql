-- 수강생 만족도 결과의 회차별 기록(추가 전용). OperationSession 테이블·운영 Mongo의 기존
-- 회차 문서는 건드리지 않는다. 회차 하나에 한 행이며 [hub-om 반영]을 다시 누르면 덮어쓴다.
CREATE TYPE "survey_comment_status" AS ENUM ('OK', 'NO_SUBJECTIVE', 'NO_SUMMARY');

CREATE TABLE "session_survey_results" (
    "id" UUID NOT NULL,
    "operation_id" TEXT NOT NULL,
    "record_id" TEXT,
    "overall" TEXT,
    "instructor_satisfaction" TEXT,
    "respondents" INTEGER,
    "positive_rate" TEXT,
    "comment_status" "survey_comment_status",
    "comment_positive" JSONB,
    "comment_improve" JSONB,
    "applied_by" TEXT,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_by_pii_index" TEXT,

    CONSTRAINT "session_survey_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "session_survey_results_operation_id_key" ON "session_survey_results"("operation_id");

-- 코멘트·반영자는 암호화 칸이라 감사 기록 값 목록에서 뺀다(activity/field-policy.json과 같게).
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON session_survey_results
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["operation_id", "record_id", "overall", "instructor_satisfaction", "respondents", "positive_rate", "comment_status", "applied_at"]');
