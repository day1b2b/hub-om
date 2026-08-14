-- 과정(Course) 단위를 안정적으로 가리킬 hub-om 내부 채번 "과정ID"(process_seq)를 추가한다.
-- 코스ID(course_id)는 사내 다른 시스템이 나중에 채워 넣는 값이라 비어있을 수 있는 반면,
-- process_seq는 과정 행이 생성되는 즉시 DB가 시퀀스로 채번하므로 항상 존재한다.
-- 기존 courses 행에도 시퀀스 순서대로 값이 채워진다(DEFAULT nextval가 매 행마다 평가됨).
CREATE SEQUENCE "courses_process_seq_seq";

ALTER TABLE "courses" ADD COLUMN "process_seq" INTEGER NOT NULL DEFAULT nextval('courses_process_seq_seq');

ALTER SEQUENCE "courses_process_seq_seq" OWNED BY "courses"."process_seq";

CREATE UNIQUE INDEX "courses_process_seq_key" ON "courses"("process_seq");
