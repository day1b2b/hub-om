-- 캘린더 이벤트를 되살린 횟수. 사람이 반복해서 지울 때 무한 복구를 멈추는 기준이다.
-- 추가형 변경이다: 기존 행은 기본값 0으로 채워지고, 다른 컬럼과 운영현황 테이블은 건드리지 않는다.
ALTER TABLE "calendar_event_links" ADD COLUMN "recreate_count" INTEGER NOT NULL DEFAULT 0;
