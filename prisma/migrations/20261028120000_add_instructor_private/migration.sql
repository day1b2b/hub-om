-- 강사 개인정보(연락처·이메일·생년월일) 암호화 저장 + 열람 감사. 코치 private 테이블을 미러.
-- 평문 컬럼에는 애플리케이션 투명 암호화로 ciphertext가 저장되고, *_pii_index/birth_date_encrypted는
-- blind index/저장 컬럼이다(withPrivacyDatabase). 둘 다 instructor_notes(id)에 1:N/1:1 FK(CASCADE).

-- CreateTable
CREATE TABLE "instructor_private_profiles" (
    "instructor_note_id" UUID NOT NULL,
    "contact" TEXT,
    "contact2" TEXT,
    "email" TEXT,
    "email2" TEXT,
    "birth_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "contact_pii_index" TEXT,
    "contact2_pii_index" TEXT,
    "email_pii_index" TEXT,
    "email2_pii_index" TEXT,
    "birth_date_encrypted" TEXT,

    CONSTRAINT "instructor_private_profiles_pkey" PRIMARY KEY ("instructor_note_id")
);

-- CreateTable
CREATE TABLE "instructor_private_access_logs" (
    "id" UUID NOT NULL,
    "instructor_note_id" UUID NOT NULL,
    "accessed_by_email" TEXT NOT NULL,
    "accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "context" TEXT,
    "accessed_by_email_pii_index" TEXT,

    CONSTRAINT "instructor_private_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instructor_priv_access_note_at_idx" ON "instructor_private_access_logs"("instructor_note_id", "accessed_at");

-- CreateIndex
CREATE INDEX "instructor_priv_access_email_at_idx" ON "instructor_private_access_logs"("accessed_by_email", "accessed_at");

-- AddForeignKey
ALTER TABLE "instructor_private_profiles" ADD CONSTRAINT "instructor_private_profiles_instructor_note_id_fkey" FOREIGN KEY ("instructor_note_id") REFERENCES "instructor_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_private_access_logs" ADD CONSTRAINT "instructor_private_access_logs_instructor_note_id_fkey" FOREIGN KEY ("instructor_note_id") REFERENCES "instructor_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Activity 변경이력 트리거: private profile은 허용목록 비움('[]')이라 모든 변경이 redacted(coach_private_profiles와 동일).
-- instructor_private_access_logs는 접근 로그라 변경이력에서 제외(table-exclusions.json) → 트리거 없음.
DROP TRIGGER IF EXISTS activity_change ON instructor_private_profiles;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON instructor_private_profiles
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('[]');
