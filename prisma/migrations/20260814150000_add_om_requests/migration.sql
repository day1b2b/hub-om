-- om-request(업무 요청) 접수 창구를 로컬 JSON(om-requests.json)에서 이 테이블로 옮긴다.
-- 신규 테이블만 추가한다. 기존 테이블/컬럼 변경이나 데이터 삭제는 없다.
--
-- operation_id는 이 요청으로 자동 생성된 운영현황(operation_sessions) 건을 가리키는
-- 느슨한 참조 문자열이다(이 앱 전체가 courseId/operationId를 다루는 방식과 동일하게
-- FK 제약 없이 둔다). 실제 데이터 이관은 scripts/import-om-requests-from-local-json.mjs로
-- 별도 실행한다(이 migration은 스키마만 만든다).
CREATE TABLE "om_requests" (
    "id" TEXT NOT NULL,
    "assigned_om" TEXT,
    "operation_id" TEXT,
    "team" TEXT NOT NULL,
    "ld" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "business_number" TEXT,
    "training_type" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "course_category_major" TEXT,
    "course_category" TEXT NOT NULL,
    "tools" TEXT,
    "instructor_name" TEXT NOT NULL,
    "syncup_link" TEXT NOT NULL,
    "drive_link" TEXT NOT NULL,
    "skillflo_setup" TEXT NOT NULL,
    "skillmatch_setup" TEXT NOT NULL,
    "on_site_operation" TEXT NOT NULL,
    "coach_request" TEXT NOT NULL,
    "total_sessions" INTEGER NOT NULL,
    "sessions" JSONB NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "om_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "om_requests_operation_id_idx" ON "om_requests"("operation_id");

CREATE INDEX "om_requests_assigned_om_idx" ON "om_requests"("assigned_om");
