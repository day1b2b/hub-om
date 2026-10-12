// 기획서 상태표 생성기 + CI 검사. 설계: docs/operations/behavior-spec-design.md
//   node scripts/spec/spec-status.mjs          → specs/STATUS.md 다시 만들기
//   node scripts/spec/spec-status.mjs --check  → CI: 빈칸·미분류 입구·STATUS.md 불일치면 실패
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ENTRY_MAP, STATUS_FILE, buildMatrix, checkEntranceClassification, collectEntrances, loadSpecs, renderMatrix } from "./spec-lib.mjs";

const root = process.cwd();
const check = process.argv.includes("--check");

function taggedTestFiles() {
  try {
    return execFileSync("git", ["grep", "-l", "--untracked", "-F", "[spec:", "--", "src/**/*.test.ts"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch { return []; }
}

function runTaggedTests(files) {
  if (files.length === 0) return [];
  const out = path.join(mkdtempSync(path.join(tmpdir(), "spec-status-")), "results.jsonl");
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types", "--experimental-test-module-mocks", "--experimental-loader", "./scripts/ts-loader.mjs", "--no-warnings",
    "--test", "--test-reporter=./scripts/spec/spec-reporter.mjs", `--test-reporter-destination=${out}`,
    "--test-reporter=dot", "--test-reporter-destination=stderr", ...files
  ], { cwd: root, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, OPERATION_DATA_SOURCE: process.env.OPERATION_DATA_SOURCE ?? "local" } });
  if (!existsSync(out)) throw new Error(`테스트 실행 결과가 없습니다 (exit ${result.status}).`);
  return readFileSync(out, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    .map((item) => ({ ...item, file: path.relative(root, item.file.replace(/^file:\/\//, "")) }));
}

const specs = loadSpecs(root);
const entryMap = existsSync(ENTRY_MAP) ? JSON.parse(readFileSync(ENTRY_MAP, "utf8")) : {};
const problems = specs.flatMap((spec) => spec.errors);
problems.push(...checkEntranceClassification(specs, entryMap, collectEntrances(root)));

const matrix = buildMatrix(specs, runTaggedTests(taggedTestFiles()));
problems.push(...matrix.failures);
const rendered = renderMatrix(matrix, entryMap) + "\n";

if (check) {
  const current = existsSync(STATUS_FILE) ? readFileSync(STATUS_FILE, "utf8") : "";
  if (current !== rendered) problems.push(`${STATUS_FILE}가 최신이 아닙니다. node scripts/spec/spec-status.mjs 를 실행하고 커밋하세요.`);
} else {
  writeFileSync(STATUS_FILE, rendered);
  console.log(`${STATUS_FILE}를 다시 만들었습니다.`);
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, rendered + "\n");
for (const warning of matrix.warnings) console.warn(`⚠️  ${warning}`);
for (const problem of problems) console.error(`❌ ${problem}`);
if (problems.length) {
  console.error(`\n기획서 검사 실패 ${problems.length}건. 규칙·입구·테스트 연결 방법은 docs/operations/behavior-spec-design.md를 보세요.`);
  process.exit(1);
}
console.log(`기획서 검사 통과: 업무 ${specs.length}개, 경고 ${matrix.warnings.length}건.`);
