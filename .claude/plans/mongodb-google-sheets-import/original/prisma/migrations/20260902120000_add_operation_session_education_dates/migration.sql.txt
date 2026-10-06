-- 회차(operation_sessions)에 "실제 교육이 있는 날짜" 목록을 별도로 저장한다.
-- 지금까지는 start_date~end_date 사이 모든 날짜가 교육일이라고 가정했지만,
-- 실제로는 중간에 주말 등으로 건너뛰는 날이 있어(예: 9/3, 9/4, 9/7) 그 사이 날짜까지
-- 교육일로 취급되는 문제가 있었다. education_dates가 비어 있는 기존 행은 이전 가정(범위 전체)을
-- 그대로 유지하고, 새로 등록/수정하는 회차부터 정확한 날짜 배열을 채운다.
ALTER TABLE "operation_sessions" ADD COLUMN "education_dates" DATE[] NOT NULL DEFAULT ARRAY[]::DATE[];
