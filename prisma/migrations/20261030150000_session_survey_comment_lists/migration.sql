-- 수강생 코멘트를 두 갈래 칸(comment_positive·comment_improve)에서 네 갈래를 담는 JSON 한 칸으로 바꾼다.
-- 이 테이블은 기능 배포 전이라 비어 있다(20261030120000에서 만든 뒤 쓰기 경로가 운영에 나간 적 없음).
ALTER TABLE "session_survey_results" DROP COLUMN "comment_positive",
DROP COLUMN "comment_improve",
ADD COLUMN "comment_lists" JSONB;
