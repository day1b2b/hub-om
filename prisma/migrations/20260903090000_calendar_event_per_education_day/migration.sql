-- 회차 1건 ↔ 구글 이벤트 1건에서 "실제 교육일 1일 ↔ 이벤트 1건"으로 전환한다.
-- 회차 기간(9/04~9/08) 안에 쉬는 날이 있으면 기간 이벤트 하나로는 교육 없는 날까지
-- 일정이 잡히기 때문이다. 이 테이블은 캘린더 연동 전용이고 운영 데이터는 건드리지 않는다.

ALTER TABLE "calendar_event_links" ADD COLUMN "event_date" DATE;

-- 기존 행은 그 시점에 기간 이벤트 1건이었으므로 회차 시작일을 교육일로 본다.
-- 회차를 못 찾는 행(이미 삭제된 회차)은 생성일로 채워 NOT NULL 제약을 만족시킨다.
UPDATE "calendar_event_links" AS l
SET "event_date" = COALESCE(
  (SELECT s."start_date" FROM "operation_sessions" AS s WHERE s."operation_id" = l."operation_id"),
  l."created_at"::date
);

ALTER TABLE "calendar_event_links" ALTER COLUMN "event_date" SET NOT NULL;

-- 회차당 1건 제약을 (회차, 교육일)당 1건으로 바꾼다.
DROP INDEX "calendar_event_links_operation_id_key";
CREATE UNIQUE INDEX "calendar_event_links_operation_id_event_date_key" ON "calendar_event_links"("operation_id", "event_date");
CREATE INDEX "calendar_event_links_operation_id_idx" ON "calendar_event_links"("operation_id");
-- 역반영이 구글에서 읽은 이벤트로 회차를 거꾸로 찾을 때 쓴다.
CREATE INDEX "calendar_event_links_calendar_id_event_id_idx" ON "calendar_event_links"("calendar_id", "event_id");
