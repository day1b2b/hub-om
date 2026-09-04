-- 노션 코치(실습코치/운영조교) 연동 키를 이름 → ID로 바꾼다.
--
-- 이름은 노션에서 바뀔 수 있고 같은 이름이 여러 행으로 있다(2026-09-04 노션 확인: 66행 중 5쌍).
-- 이름으로만 매칭하면 두 행이 한 코치 행을 공유해 서로의 값을 덮어쓴다.
-- 강사(instructor_notes.notion_no, 20260825100000)와 같은 방식이다.
--
-- employee_no(사번): 1순위 키. 현재 연동 DB "실습코치/운영조교 DB (26.08 ver)"의 사람 단위 ID이고,
--   계약시트(조교실습코치_일반계약요청)도 같은 사번을 쓴다. 2026-09-04 기준 66행 중 51행이 유일한
--   사번을 갖고, 15행은 발급 전(공란 10 · "0" 5)이라 NULL이다.
-- notion_no: 2순위 키. 레거시 노션 코치 DB의 auto increment ID("No ID", 예: CH-51).
--
-- 둘 다 NULL인 코치(계약시트로만 들어온 행, 사번 발급 전 행)는 계속 이름으로 식별한다.
-- PostgreSQL의 unique는 NULL을 중복으로 보지 않으므로 여러 행이 공존할 수 있다.
-- 기존 행의 키는 첫 동기화가 이름으로 찾아 채운다(별도 backfill 스크립트 없음).

ALTER TABLE "coaches" ADD COLUMN "employee_no" TEXT;
ALTER TABLE "coaches" ADD COLUMN "notion_no" INTEGER;

CREATE UNIQUE INDEX "coaches_employee_no_key" ON "coaches"("employee_no");
CREATE UNIQUE INDEX "coaches_notion_no_key" ON "coaches"("notion_no");
