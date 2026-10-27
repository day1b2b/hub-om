-- 코치 운영 정책의 투입별 역할·평가·사실 기록. 기존 coach_engagements는 바꾸지 않는다.
-- 운영 Mongo는 같은 구조의 새 컬렉션을 prepare 명령으로 만든다(docs/operations/coach-evaluation-collections.md).

-- CreateEnum
CREATE TYPE "coach_engagement_role" AS ENUM ('practice_coach', 'lead', 'operation_assistant');

-- CreateEnum
CREATE TYPE "coach_practice_difficulty" AS ENUM ('a', 'b', 'c');

-- CreateEnum
CREATE TYPE "coach_audience" AS ENUM ('executive', 'staff');

-- CreateEnum
CREATE TYPE "coach_evaluation_source" AS ENUM ('om', 'lead', 'instructor');

-- CreateEnum
CREATE TYPE "coach_rehire_intent" AS ENUM ('yes', 'conditional', 'no');

-- CreateEnum
CREATE TYPE "coach_fact_kind" AS ENUM ('late', 'no_show', 'formal_complaint', 'left_post', 'prep_missing', 'serious_violation');

-- CreateTable
CREATE TABLE "coach_engagement_details" (
    "id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "role" "coach_engagement_role" NOT NULL,
    "practice_difficulty" "coach_practice_difficulty",
    "audience" "coach_audience",
    "is_new_client" BOOLEAN,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_pii_index" TEXT,

    CONSTRAINT "coach_engagement_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_evaluations" (
    "id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "engagement_id" UUID,
    "source" "coach_evaluation_source" NOT NULL,
    "course_name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "practice_support" SMALLINT,
    "field_operation" SMALLINT,
    "communication" SMALLINT,
    "leading" SMALLINT,
    "punctuality" SMALLINT,
    "rehire" "coach_rehire_intent" NOT NULL,
    "rehire_reason" TEXT,
    "evidence" TEXT,
    "evaluator_email" TEXT NOT NULL,
    "evaluator_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "rehire_reason_pii_index" TEXT,
    "evidence_pii_index" TEXT,
    "evaluator_email_pii_index" TEXT,
    "evaluator_name_pii_index" TEXT,
    "deleted_by_pii_index" TEXT,

    CONSTRAINT "coach_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_fact_records" (
    "id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "engagement_id" UUID,
    "kind" "coach_fact_kind" NOT NULL,
    "occurred_on" DATE NOT NULL,
    "course_name" TEXT,
    "description" TEXT NOT NULL,
    "recorded_by_email" TEXT NOT NULL,
    "recorded_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "description_pii_index" TEXT,
    "recorded_by_email_pii_index" TEXT,
    "recorded_by_name_pii_index" TEXT,
    "deleted_by_pii_index" TEXT,

    CONSTRAINT "coach_fact_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coach_engagement_details_engagement_id_key" ON "coach_engagement_details"("engagement_id");

-- CreateIndex
CREATE INDEX "coach_engagement_details_coach_id_idx" ON "coach_engagement_details"("coach_id");

-- CreateIndex
CREATE INDEX "coach_evaluations_coach_id_idx" ON "coach_evaluations"("coach_id");

-- CreateIndex
CREATE INDEX "coach_evaluations_engagement_id_idx" ON "coach_evaluations"("engagement_id");

-- CreateIndex
CREATE INDEX "coach_evaluations_deleted_at_idx" ON "coach_evaluations"("deleted_at");

-- CreateIndex
CREATE INDEX "coach_fact_records_coach_id_idx" ON "coach_fact_records"("coach_id");

-- CreateIndex
CREATE INDEX "coach_fact_records_engagement_id_idx" ON "coach_fact_records"("engagement_id");

-- CreateIndex
CREATE INDEX "coach_fact_records_deleted_at_idx" ON "coach_fact_records"("deleted_at");

-- AddForeignKey
ALTER TABLE "coach_engagement_details" ADD CONSTRAINT "coach_engagement_details_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "coach_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_engagement_details" ADD CONSTRAINT "coach_engagement_details_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_evaluations" ADD CONSTRAINT "coach_evaluations_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_evaluations" ADD CONSTRAINT "coach_evaluations_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "coach_engagements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_fact_records" ADD CONSTRAINT "coach_fact_records_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_fact_records" ADD CONSTRAINT "coach_fact_records_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "coach_engagements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
