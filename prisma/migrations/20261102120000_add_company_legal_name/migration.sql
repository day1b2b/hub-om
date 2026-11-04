-- 기업위키 사업자등록증 정보에 상호(법인명)를 추가한다. 기업명과 법인명이 다른 경우 계산서 회사명에 쓴다.
-- nullable, 기본값 없음, 기존 row는 전혀 바뀌지 않는다(백필 없음).
-- 법인명은 공개 정보라 암호화하지 않는다(업태/종목과 같은 operational 분류).
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "companies"
  ADD COLUMN "legal_name" TEXT;

COMMIT;
