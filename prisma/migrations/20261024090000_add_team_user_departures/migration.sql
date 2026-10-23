-- 퇴사자를 TeamUser에서 물리 삭제하거나 TeamUser 스키마를 바꾸지 않고 표시하기 위한
-- 추가 전용(additive) 테이블. 행이 있으면 퇴사, 없으면 재직이다(행 삭제 = 재직 복귀).
-- 기존 team_users 테이블/운영 Mongo 문서는 전혀 건드리지 않는다.
CREATE TABLE "team_user_departures" (
    "id" UUID NOT NULL,
    "team_user_id" UUID NOT NULL,
    "departed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_user_departures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_user_departures_team_user_id_key" ON "team_user_departures"("team_user_id");
