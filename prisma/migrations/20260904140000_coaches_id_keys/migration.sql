-- 노션 코치(실습코치/운영조교) 연동 키를 이름 → 노션 ID로 바꾼다.
--
-- 이름은 노션에서 바뀔 수 있고 같은 이름이 여러 행으로 있다(2026-09-04 노션 확인: 66행 중 5쌍).
-- 이름으로만 매칭하면 두 행이 한 코치 행을 공유해 서로의 값을 덮어쓴다.
-- 강사(instructor_notes.notion_no, 20260825100000)와 같은 방식이다.
--
-- notion_no: 연결 키. 노션 코치 DB "실습코치/운영조교 DB (26.08 ver)"에 강사 DB와 같은 방식으로
--   "ID"(auto increment, 접두어 CO) 속성을 만들어 66행 전부 값이 붙었다(2026-09-04, CO-225~CO-290).
--   접두어는 표시용이고 이 컬럼에는 숫자만 담는다.
--   노션에 없는 코치(계약시트로만 들어온 행)는 NULL이며, 그 경우에만 이름으로 식별한다.
-- employee_no: 사번. 키가 아니라 값이다. 계약시트(조교실습코치_일반계약요청 D열)도 같은 사번을
--   쓰므로 나중에 원천을 이어 붙일 때 쓴다. 발급 전인 행(공란 10 · "0" 5)은 NULL이다.
--
-- PostgreSQL의 unique는 NULL을 중복으로 보지 않으므로 값이 없는 행은 여러 개 공존할 수 있다.
-- 기존 코치 행의 notion_no는 첫 동기화가 이름으로 찾아 채운다(별도 backfill 스크립트 없음).

ALTER TABLE "coaches" ADD COLUMN "employee_no" TEXT;
ALTER TABLE "coaches" ADD COLUMN "notion_no" INTEGER;

CREATE UNIQUE INDEX "coaches_employee_no_key" ON "coaches"("employee_no");
CREATE UNIQUE INDEX "coaches_notion_no_key" ON "coaches"("notion_no");
