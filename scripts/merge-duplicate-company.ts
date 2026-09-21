/**
 * 오타/중복으로 따로 생성된 기업(회사) 레코드를 정상 기업으로 병합한다.
 *
 * 배경: 기업명은 companies.normalized_name UNIQUE 제약 때문에 "이미 있는 이름으로
 * 바로 개명"이 불가능하고(예: "현대건선" -> "현대건설"), 과정(Course)의 companyId도
 * 관리자 DB 화면에서 읽기 전용이라 UI로는 재할당할 수 없다. 이 스크립트는 source
 * 기업 아래 과정(course)을 target 기업으로 옮기고, courses.@@unique([companyId,
 * courseId, name]) 충돌이 나면(= target에 이미 같은 코스ID+과정명이 있으면) 그
 * 기존 과정으로 회차(OperationSession)를 재배정한 뒤 비어버린 source 과정 행을
 * 정리한다. courseIdLabel도 같은 방식으로 옮긴다.
 *
 * source 기업 자체(companies 행)는 지우지 않는다 — 실행 후 과정이 0건이 되면
 * 로그로 알려주니, 정리 여부는 데이터 책임자가 별도로 판단한다.
 *
 * 실행:
 *   npm run db:merge:duplicate-company -- --source="현대건선" --target="현대건설" --dry-run
 *   npm run db:merge:duplicate-company -- --source="현대건선" --target="현대건설" --apply
 */

import { config } from "dotenv";
import { getPrismaClient } from "../src/lib/data/prisma";

config({ path: ".env.local" });
config({ path: ".env" });

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

const apply = process.argv.includes("--apply");
const sourceName = readArg("source");
const targetName = readArg("target");

async function main(): Promise<void> {
  if (!sourceName || !targetName) {
    console.error("[merge-duplicate-company] --source=\"기업명\" --target=\"기업명\"이 모두 필요합니다.");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("[merge-duplicate-company] DATABASE_URL이 없어 실행을 중단합니다.");
    process.exit(1);
  }

  console.log(`[merge-duplicate-company] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);
  console.log(`[merge-duplicate-company] source="${sourceName}" -> target="${targetName}"`);

  const prisma = getPrismaClient();

  try {
    const [sourceCandidates, targetCandidates] = await Promise.all([
      prisma.company.findMany({ where: { name: sourceName } }),
      prisma.company.findMany({ where: { name: targetName } })
    ]);

    if (sourceCandidates.length !== 1) {
      console.error(
        `[merge-duplicate-company] source "${sourceName}" 이름과 정확히 일치하는 기업이 ${sourceCandidates.length}건입니다. 정확한 이름인지 확인하세요.`
      );
      process.exit(1);
    }

    if (targetCandidates.length !== 1) {
      console.error(
        `[merge-duplicate-company] target "${targetName}" 이름과 정확히 일치하는 기업이 ${targetCandidates.length}건입니다. 정확한 이름인지 확인하세요.`
      );
      process.exit(1);
    }

    const source = sourceCandidates[0];
    const target = targetCandidates[0];

    if (source.id === target.id) {
      console.error("[merge-duplicate-company] source와 target이 같은 기업입니다. 중단합니다.");
      process.exit(1);
    }

    const sourceCourses = await prisma.course.findMany({
      where: { companyId: source.id },
      include: { sessions: { select: { id: true } } }
    });

    if (sourceCourses.length === 0) {
      console.log(`[merge-duplicate-company] source "${sourceName}"에 옮길 과정이 없습니다. 확인만 하고 종료합니다.`);
      return;
    }

    const plan: Array<{
      action: "reassign" | "merge-into-existing";
      courseId: string;
      name: string;
      sessionCount: number;
      targetCourseId?: string;
    }> = [];

    for (const course of sourceCourses) {
      const existingTarget = await prisma.course.findFirst({
        where: { companyId: target.id, courseId: course.courseId, name: course.name }
      });

      plan.push({
        action: existingTarget ? "merge-into-existing" : "reassign",
        courseId: course.courseId,
        name: course.name,
        sessionCount: course.sessions.length,
        targetCourseId: existingTarget?.id
      });
    }

    console.log(`[merge-duplicate-company] 과정 ${sourceCourses.length}건 계획:`);
    for (const item of plan) {
      const summary = `- [${item.courseId}] "${item.name}" (회차 ${item.sessionCount}건)`;
      console.log(
        item.action === "reassign"
          ? `${summary} -> target으로 기업만 재할당`
          : `${summary} -> target의 기존 동일 과정(id=${item.targetCourseId})으로 회차 병합 후 source 과정 삭제`
      );
    }

    const sourceLabels = await prisma.courseIdLabel.findMany({ where: { companyId: source.id } });
    for (const label of sourceLabels) {
      const existing = await prisma.courseIdLabel.findFirst({
        where: { companyId: target.id, courseId: label.courseId }
      });
      console.log(
        existing
          ? `[merge-duplicate-company] 코스ID명 [${label.courseId}] "${label.label}"은 target에 이미 "${existing.label}"이 있어 source 값은 버립니다.`
          : `[merge-duplicate-company] 코스ID명 [${label.courseId}] "${label.label}" -> target으로 재할당`
      );
    }

    if (!apply) {
      console.log("[merge-duplicate-company] dry-run 종료. 실제로 반영하려면 --apply를 붙여 다시 실행하세요.");
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const course of sourceCourses) {
        const existingTarget = await tx.course.findFirst({
          where: { companyId: target.id, courseId: course.courseId, name: course.name }
        });

        if (existingTarget) {
          await tx.operationSession.updateMany({
            where: { courseRecordId: course.id },
            data: { courseRecordId: existingTarget.id }
          });
          await tx.course.delete({ where: { id: course.id } });
        } else {
          await tx.course.update({ where: { id: course.id }, data: { companyId: target.id } });
        }
      }

      for (const label of sourceLabels) {
        const existing = await tx.courseIdLabel.findFirst({
          where: { companyId: target.id, courseId: label.courseId }
        });

        if (existing) {
          await tx.courseIdLabel.delete({ where: { id: label.id } });
        } else {
          await tx.courseIdLabel.update({ where: { id: label.id }, data: { companyId: target.id } });
        }
      }
    });

    const remaining = await prisma.course.count({ where: { companyId: source.id } });
    console.log(`[merge-duplicate-company] 완료. source "${sourceName}"에 남은 과정: ${remaining}건.`);
    if (remaining === 0) {
      console.log(
        `[merge-duplicate-company] source 기업 레코드(id=${source.id})는 이제 과정이 0건입니다. 기업 마스터 정리가 필요하면 데이터 책임자와 상의해 별도로 처리하세요(이 스크립트는 기업 행 자체는 지우지 않습니다).`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
