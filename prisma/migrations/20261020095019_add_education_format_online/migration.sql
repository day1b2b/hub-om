-- 교육형태(education_format)에 "온라인"을 "비대면"과 구분되는 별도 값으로 추가한다.
-- Postgres에서 enum 값 추가는 덧붙이기만 하는 작업이라 기존 데이터에는 영향이 없다.
ALTER TYPE "education_format" ADD VALUE 'online';
