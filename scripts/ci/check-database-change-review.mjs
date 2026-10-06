import { execFileSync } from "node:child_process";

const REVIEW_LABEL = "database-change-reviewed";
const CUTOVER_LABEL = "database-cutover-approved";

export function classifyDatabaseChange(paths, patch) {
  const sensitivePath = paths.some((path) =>
    /^(prisma\/|Dockerfile$|prisma\.config\.ts$|\.env\.example$|scripts\/docker-entrypoint\.sh$|src\/lib\/(mongodb|migration)\/)/.test(path)
    || /(^|\/)(mongo|mongodb)[^/]*\.(?:ts|js|mjs|json)$/i.test(path)
    || /^src\/lib\/data\/.*(?:Composition|Repository|Runtime)\.(?:ts|js)$/.test(path)
  );

  const databaseSignal = sensitivePath
    && /^[+-](?![+-]).*(?:MONGODB_|DATABASE_URL|RUN_DB_MIGRATIONS|_BACKEND|mongodb-shadow|getDataRepositoryOverride)/im.test(patch);
  const cutoverSignal = sensitivePath
    && /^\+(?!\+).*(?:_BACKEND\s*=.*mongodb|mongodb-shadow|RUN_DB_MIGRATIONS\s*=\s*true)/im.test(patch);

  return {
    requiresReview: sensitivePath || databaseSignal,
    requiresCutoverApproval: cutoverSignal,
  };
}

export function missingLabels(classification, labels) {
  const missing = [];
  if (classification.requiresReview && !labels.has(REVIEW_LABEL)) missing.push(REVIEW_LABEL);
  if (classification.requiresCutoverApproval && !labels.has(CUTOVER_LABEL)) missing.push(CUTOVER_LABEL);
  return missing;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
}

function main() {
  const base = process.env.DATABASE_GUARD_BASE;
  if (!base) throw new Error("DATABASE_GUARD_BASE가 필요합니다.");

  const labels = new Set((process.env.PR_LABELS ?? "").split(",").map((label) => label.trim()).filter(Boolean));
  const paths = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
  const patch = git("diff", "--unified=0", "--no-ext-diff", `${base}...HEAD`);
  const classification = classifyDatabaseChange(paths, patch);
  const missing = missingLabels(classification, labels);

  if (missing.length > 0) {
    console.error("DB·배포 경로 변경 검토가 확인되지 않았습니다.");
    console.error(`필요한 PR 라벨: ${missing.join(", ")}`);
    console.error("docs/operations/2026-10-06-mongodb-cutover-incident.md의 재개 조건을 확인하세요.");
    process.exit(1);
  }

  if (classification.requiresReview) {
    console.log("DB·배포 경로 변경 승인 라벨을 확인했습니다.");
  } else {
    console.log("DB 전환 검토 대상 변경이 없습니다.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
