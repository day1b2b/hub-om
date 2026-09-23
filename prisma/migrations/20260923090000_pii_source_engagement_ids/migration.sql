-- 이름이 포함될 수 있는 투입/슬롯 원천 식별자의 HMAC 조회 컬럼과 원문 고유성 제약을 추가한다.
-- Maintenance migration: 동기화·수기 투입 쓰기를 멈춘 상태에서 적용하고, 트래픽 재개 전에
-- `npm run privacy:migrate -- --apply --backup-confirmed --maintenance-confirmed`와 `--enforce`로 backfill·검증한다.
-- 적용 직후 기존 평문 행의 조회 컬럼은 NULL이므로 backfill 전 신규 암호문 행과 원문 중복을 DB가 막지 못한다.
-- 기존 migration은 수정하지 않는다. 운영 반영은 책임자 검토/백업/점검 중단 후 수행한다.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable
ALTER TABLE "coach_engagements" ADD COLUMN     "source_engagement_id_pii_index" TEXT;

-- AlterTable
ALTER TABLE "coach_engagement_schedules" ADD COLUMN     "source_engagement_schedule_id_pii_index" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "coach_engagements_source_engagement_id_pii_index_key" ON "coach_engagements"("source_engagement_id_pii_index");

-- CreateIndex
CREATE UNIQUE INDEX "coach_engagement_schedules_source_engagement_schedule_id_pi_key" ON "coach_engagement_schedules"("source_engagement_schedule_id_pii_index");
COMMIT;
