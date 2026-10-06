-- 운영 현황 상세 "과정 정보"에서 결과보고서 여부와 동일한 방식으로 만족도 조사 여부를
-- 회차 단위로 관리할 수 있도록 컬럼을 추가한다. 기존 행은 전부 needs_review(확인필요)로
-- 채워지며 기존 데이터 삭제/변경 없음.
-- CreateEnum
CREATE TYPE "satisfaction_survey_status" AS ENUM ('not_required', 'needs_review');

-- AlterTable
ALTER TABLE "operation_sessions" ADD COLUMN "has_satisfaction_survey" "satisfaction_survey_status" NOT NULL DEFAULT 'needs_review';
