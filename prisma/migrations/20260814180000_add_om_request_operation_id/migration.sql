-- om-request 접수 시점에 courseId 없이 자동 생성한 운영현황 회차(첫 차수)를
-- 가리키는 operation_id를 om_requests에 추가한다. FK는 걸지 않는다 — 이 앱 전체가
-- courseId/operationId를 느슨한 join key로 다루는 방식과 동일하게 맞춘다.
ALTER TABLE "om_requests" ADD COLUMN "operation_id" TEXT;

CREATE INDEX "om_requests_operation_id_idx" ON "om_requests"("operation_id");
