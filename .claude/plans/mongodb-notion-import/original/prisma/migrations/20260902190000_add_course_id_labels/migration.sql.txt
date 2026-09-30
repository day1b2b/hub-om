-- 코스ID(백오피스 코스ID) 단위 라벨("코스ID명"). 과정(courses.course_name = "과정명")과는
-- 독립적인 테이블 — 같은 코스ID를 쓰는 여러 과정이 있어도 코스ID명은 courseId당 한 행뿐이다.
CREATE TABLE "course_id_labels" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "course_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_id_labels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "course_id_labels_company_id_course_id_key" ON "course_id_labels"("company_id", "course_id");
