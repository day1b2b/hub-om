-- 퇴사자를 물리 삭제하지 않고 상태로만 남기기 위한 필드. 기존 행은 전부 재직(active)으로 간주한다.
CREATE TYPE "team_user_status" AS ENUM ('active', 'departed');

ALTER TABLE "team_users" ADD COLUMN "status" "team_user_status" NOT NULL DEFAULT 'active';
