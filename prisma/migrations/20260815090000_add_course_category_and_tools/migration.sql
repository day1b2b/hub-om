-- 운영 현황 상세 "일정 / 운영 조건"에서 om-request 접수 내용을 노출/수정할 수 있도록
-- 과정(Course) 단위 공통 속성인 과정 카테고리 소분류, 사용 Tool 컬럼을 추가한다.
-- 두 값 모두 courseId/courseName과 같은 과정(Course) 레벨 속성이라 courses 테이블에 둔다.
ALTER TABLE "courses" ADD COLUMN "course_category" TEXT;
ALTER TABLE "courses" ADD COLUMN "tools" TEXT;
