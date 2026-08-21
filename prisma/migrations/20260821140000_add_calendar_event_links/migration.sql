-- 운영 1건 ↔ 구글 캘린더 이벤트 1건 매핑
CREATE TABLE "calendar_event_links" (
    "id" UUID NOT NULL,
    "operation_id" TEXT NOT NULL,
    "calendar_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_event_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "calendar_event_links_operation_id_key" ON "calendar_event_links"("operation_id");
