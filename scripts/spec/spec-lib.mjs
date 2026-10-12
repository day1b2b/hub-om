// 실행되는 기획서(Behavior Spec) 공통 함수. 설계: docs/operations/behavior-spec-design.md
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export const SPEC_DIR = "specs";
export const ENTRY_MAP = "specs/entry-map.json";
export const STATUS_FILE = "specs/STATUS.md";
export const SHARED_ENTRANCE = "공통";
const RULE_ID = "R\\d+[a-z]?";
const METHODS = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/;

/** spec Markdown 한 개를 읽어 업무·규칙·입구·예외·알려진 빈칸으로 나눈다. 형식 오류는 errors에 모은다. */
export function parseSpec(text, file = "spec") {
  const errors = [];
  const id = /업무 ID: `([a-z0-9-]+)`/.exec(text)?.[1];
  if (!id) errors.push(`${file}: "업무 ID: \`업무-id\`" 줄이 없습니다.`);
  const title = /^# (.+)$/m.exec(text)?.[1]?.trim() ?? id;
  const sections = {};
  let current = null;
  for (const line of text.split("\n")) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) { current = heading[1].trim(); sections[current] = []; continue; }
    if (current) sections[current].push(line);
  }
  const rules = [];
  for (const line of sections["규칙"] ?? []) {
    const match = new RegExp(`^- \\*\\*(${RULE_ID})\\*\\* (.+)$`).exec(line);
    if (match) rules.push({ id: match[1], text: match[2].trim() });
    else if (line.startsWith("- ")) errors.push(`${file}: 규칙 줄 형식이 틀렸습니다: ${line}`);
  }
  const entrances = [];
  for (const line of sections["입구"] ?? []) {
    const match = /^\| `([A-Z]+ \S+)` \|(.*)\|\s*$/.exec(line);
    if (match) entrances.push({ key: match[1], note: match[2].split("|").map((cell) => cell.trim()).filter(Boolean).join(" · ") });
  }
  const cellNotes = (name) => (sections[name] ?? []).flatMap((line) => {
    if (!line.startsWith("- ")) return [];
    const match = new RegExp(`^- \\*\\*(${RULE_ID}) @ \`([^\`]+)\`\\*\\* — (.*)$`).exec(line);
    if (!match || !match[3].trim()) { errors.push(`${file}: ${name} 줄은 "- **R1 @ \`입구\`** — 이유" 형식이고 이유가 필요합니다: ${line}`); return []; }
    return [{ rule: match[1], entrance: match[2], reason: match[3].trim() }];
  });
  const exceptions = cellNotes("예외");
  const gaps = cellNotes("알려진 빈칸");

  const ruleIds = new Set(rules.map((rule) => rule.id));
  const entranceKeys = new Set(entrances.map((entrance) => entrance.key));
  if (ruleIds.size !== rules.length) errors.push(`${file}: 규칙 ID가 중복됩니다.`);
  if (rules.length === 0) errors.push(`${file}: 규칙이 없습니다.`);
  if (entrances.length === 0) errors.push(`${file}: 입구가 없습니다.`);
  const seenCells = new Set();
  for (const note of [...exceptions, ...gaps]) {
    if (!ruleIds.has(note.rule)) errors.push(`${file}: 없는 규칙을 가리킵니다: ${note.rule}`);
    if (!entranceKeys.has(note.entrance)) errors.push(`${file}: 입구 표에 없는 입구를 가리킵니다: ${note.entrance}`);
    const cell = `${note.rule} @ ${note.entrance}`;
    if (seenCells.has(cell)) errors.push(`${file}: 같은 칸이 예외/알려진 빈칸에 두 번 있습니다: ${cell}`);
    seenCells.add(cell);
  }
  return { id, title, file, rules, entrances, exceptions, gaps, errors };
}

export function loadSpecs(root = process.cwd()) {
  const folder = path.join(root, SPEC_DIR);
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((name) => name.endsWith(".spec.md")).sort()
    .map((name) => parseSpec(readFileSync(path.join(folder, name), "utf8"), `${SPEC_DIR}/${name}`));
}

function routeFiles(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? routeFiles(file) : entry.name === "route.ts" ? [file] : [];
  });
}

/** 코드에서 입구를 모은다: 모든 API 메서드와 package.json 스크립트. */
export function collectEntrances(root = process.cwd()) {
  const keys = [];
  const appDir = path.join(root, "src/app");
  for (const file of routeFiles(path.join(appDir, "api"))) {
    const route = "/" + path.relative(appDir, path.dirname(file)).split(path.sep).join("/");
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const declarations = ts.isVariableStatement(statement) ? statement.declarationList.declarations : ts.isFunctionDeclaration(statement) ? [statement] : [];
      for (const declaration of declarations) {
        const names = declaration.name && ts.isObjectBindingPattern(declaration.name)
          ? declaration.name.elements.map((element) => element.name.getText(source)) : [declaration.name?.getText(source)];
        for (const name of names) if (name && METHODS.test(name)) keys.push(`${name} ${route}`);
      }
    }
  }
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  for (const name of Object.keys(pkg.scripts ?? {})) keys.push(`SCRIPT ${name}`);
  return [...new Set(keys)].sort();
}

/** 입구가 모두 spec 또는 entry-map에 정확히 한 번 분류됐는지 본다. */
export function checkEntranceClassification(specs, entryMap, collected) {
  const errors = [];
  const owner = new Map();
  for (const spec of specs) for (const entrance of spec.entrances) {
    if (owner.has(entrance.key)) {
      // 한 입구가 여러 업무에 속할 수 있다(예: 과정 삭제는 회차 삭제이면서 과정 정리). 중복 자체는 허용.
      owner.get(entrance.key).push(spec.id);
    } else owner.set(entrance.key, [spec.id]);
  }
  const collectedSet = new Set(collected);
  for (const key of collected) {
    const inSpec = owner.has(key);
    const inMap = Object.hasOwn(entryMap, key);
    if (!inSpec && !inMap) errors.push(`분류 안 된 입구: ${key} — 업무 spec 입구 표 또는 ${ENTRY_MAP}에 추가하세요.`);
    if (inSpec && inMap) errors.push(`입구가 spec(${owner.get(key).join(", ")})과 ${ENTRY_MAP}에 동시에 있습니다: ${key}`);
  }
  for (const key of owner.keys()) if (!collectedSet.has(key)) errors.push(`코드에 없는 입구가 spec에 있습니다: ${key}`);
  for (const [key, value] of Object.entries(entryMap)) {
    if (!collectedSet.has(key)) errors.push(`코드에 없는 입구가 ${ENTRY_MAP}에 있습니다: ${key}`);
    if (!isValidEntryValue(value)) errors.push(`${ENTRY_MAP} 값 형식이 틀렸습니다: ${key} → ${value}`);
  }
  return errors;
}

export function isValidEntryValue(value) {
  return value === "미검토" || /^해당 없음: \S/.test(value) || /^기획서 없음: \S/.test(value);
}

// 입구에 [operationId] 같은 대괄호가 들어가므로 한 단계 대괄호 쌍은 입구의 일부로 읽는다.
const TAG = new RegExp(`\\[spec:([a-z0-9-]+) (${RULE_ID}(?:,${RULE_ID})*) \\| ((?:[^\\[\\]]|\\[[^\\[\\]]*\\])+)\\]`, "g");

/** 테스트 이름에서 [spec:업무 R1,R2 | 입구] 표시를 모두 읽는다. */
export function parseTags(name) {
  return [...name.matchAll(TAG)].flatMap((match) => match[2].split(",").map((rule) => ({ spec: match[1], rule, entrance: match[3].trim() })));
}

/**
 * 테스트 결과로 규칙×입구 표를 만든다.
 * results: [{ name, file, passed, todo }]
 */
export function buildMatrix(specs, results) {
  const warnings = [];
  const failures = [];
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const evidence = new Map();
  for (const result of results) {
    const tags = parseTags(result.name);
    for (const tag of tags) {
      const spec = byId.get(tag.spec);
      const known = spec && spec.rules.some((rule) => rule.id === tag.rule)
        && (tag.entrance === SHARED_ENTRANCE || spec.entrances.some((entrance) => entrance.key === tag.entrance));
      if (!known) { warnings.push(`규칙/입구를 찾을 수 없는 테스트(고아): "${result.name}" (${result.file})`); continue; }
      const cell = `${tag.spec}|${tag.rule}|${tag.entrance}`;
      if (!evidence.has(cell)) evidence.set(cell, []);
      evidence.get(cell).push(result);
    }
  }

  const tables = specs.map((spec) => {
    const columns = [...spec.entrances.map((entrance) => entrance.key)];
    const hasShared = spec.rules.some((rule) => evidence.has(`${spec.id}|${rule.id}|${SHARED_ENTRANCE}`));
    const rows = spec.rules.map((rule) => {
      const cells = columns.map((entrance) => {
        const exception = spec.exceptions.find((note) => note.rule === rule.id && note.entrance === entrance);
        const gap = spec.gaps.find((note) => note.rule === rule.id && note.entrance === entrance);
        const tests = evidence.get(`${spec.id}|${rule.id}|${entrance}`) ?? [];
        const failed = tests.filter((test) => !test.passed && !test.todo);
        const passed = tests.filter((test) => test.passed);
        const where = `${spec.id} ${rule.id} @ ${entrance}`;
        if (exception) {
          if (tests.length) warnings.push(`예외 칸에 테스트가 연결돼 있습니다: ${where}`);
          return { status: "exception", mark: "➖", tests };
        }
        if (failed.length) {
          failures.push(`실패한 테스트: ${where} — ${failed.map((test) => test.name).join(" / ")}`);
          return { status: "fail", mark: "❌", tests };
        }
        if (gap) {
          if (passed.length && passed.length === tests.length) {
            warnings.push(`알려진 빈칸이 메워졌습니다. spec의 "알려진 빈칸"에서 지우고 todo를 풀어 주세요: ${where}`);
            return { status: "gap-filled", mark: "✅ (빈칸 해제 필요)", tests };
          }
          return { status: "gap", mark: "🟡", tests };
        }
        const todoPassed = passed.filter((test) => test.todo);
        if (todoPassed.length) warnings.push(`todo 테스트가 통과합니다. todo를 풀어 주세요: ${where}`);
        if (passed.some((test) => !test.todo)) return { status: "pass", mark: "✅", tests };
        failures.push(`빈칸(연결된 통과 테스트 없음): ${where}`);
        return { status: "missing", mark: "❌", tests };
      });
      const shared = evidence.get(`${spec.id}|${rule.id}|${SHARED_ENTRANCE}`) ?? [];
      for (const test of shared) if (!test.passed && !test.todo) failures.push(`실패한 공통 테스트: ${spec.id} ${rule.id} — ${test.name}`);
      return { rule, cells, shared };
    });
    return { spec, columns, hasShared, rows };
  });
  return { tables, warnings, failures };
}

const escapeCell = (text) => text.replaceAll("|", "\\|");

export function renderMatrix(matrix, entryMap = {}) {
  const lines = ["# 기획서 상태표", "", "> 자동 생성 파일입니다. 직접 고치지 말고 `node scripts/spec/spec-status.mjs`로 다시 만드세요.", "",
    "표시: ✅ 연결된 테스트 통과 · ❌ 빈칸 또는 실패 · 🟡 알려진 빈칸(고칠 예정) · ➖ 예외(해당 없음)", ""];
  for (const { spec, columns, hasShared, rows } of matrix.tables) {
    lines.push(`## ${spec.title} (\`${spec.id}\`)`, "", `기획서: [${spec.file}](${path.basename(spec.file)})`, "");
    const header = ["규칙", ...columns.map((column) => `\`${column}\``), ...(hasShared ? ["공통 테스트"] : [])];
    lines.push(`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`);
    for (const row of rows) {
      const shared = hasShared ? [row.shared.length ? `${row.shared.filter((test) => test.passed).length}/${row.shared.length} 통과` : ""] : [];
      lines.push(`| **${row.rule.id}** ${escapeCell(row.rule.text)} | ${row.cells.map((cell) => cell.mark).join(" | ")}${shared.length ? ` | ${shared[0]}` : ""} |`);
    }
    const notes = [...spec.exceptions.map((note) => ["➖", note]), ...spec.gaps.map((note) => ["🟡", note])];
    if (notes.length) {
      lines.push("");
      for (const [mark, note] of notes) lines.push(`- ${mark} **${note.rule} @ \`${note.entrance}\`** — ${note.reason}`);
    }
    lines.push("");
  }
  const values = Object.values(entryMap);
  if (values.length) {
    const unreviewed = values.filter((value) => value === "미검토").length;
    const none = values.filter((value) => value.startsWith("해당 없음")).length;
    const noSpec = values.filter((value) => value.startsWith("기획서 없음")).length;
    const specEntrances = new Set(matrix.tables.flatMap((table) => table.columns)).size;
    lines.push("## 입구 분류 현황", "", `| 업무 spec에 연결 | 기획서 없음(업무만 표시) | 해당 없음 | 미검토 |`, "|---|---|---|---|",
      `| ${specEntrances} | ${noSpec} | ${none} | ${unreviewed} |`, "");
  }
  return lines.join("\n");
}
