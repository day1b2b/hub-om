-- 기업위키 상세의 메모 카드를 위해 companies에 컬럼을 추가한다.
-- 전부 nullable, 기본값 없음, 기존 row는 전혀 바뀌지 않는다(백필 없음).
-- memo는 자유 입력이라 PII로 다룬다(암호화 + changeOnly). 활동 로그 트리거 값 목록은 바꾸지 않는다.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "companies"
  ADD COLUMN "memo" TEXT,
  ADD COLUMN "memo_pii_index" TEXT;

COMMIT;
