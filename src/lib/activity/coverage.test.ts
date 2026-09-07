import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

function routes(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? routes(file) : entry.name === "route.ts" ? [file] : [];
  });
}

test("every exported API method has a tracking wrapper or explicit exclusion", () => {
  const policy = JSON.parse(read("src/lib/activity/route-policy.json")) as Record<string, string>;
  const seen = new Set<string>();
  for (const file of routes(path.join(root, "src/app/api"))) {
    const route = "/" + path.relative(path.join(root, "src/app"), path.dirname(file));
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement)) {
        assert.ok(statement.exportClause && ts.isNamedExports(statement.exportClause), "API wildcard re-exports cannot be checked");
        if (ts.isNamedExports(statement.exportClause)) {
          assert.ok(!statement.exportClause.elements.some((item) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(item.name.text)), "Export methods explicitly through withActivity so coverage can verify them");
        }
      }
      if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const declarations = ts.isVariableStatement(statement) ? statement.declarationList.declarations : ts.isFunctionDeclaration(statement) ? [statement] : [];
      for (const declaration of declarations) {
        const names = declaration.name && ts.isObjectBindingPattern(declaration.name)
          ? declaration.name.elements.map((e) => e.name.getText(source)) : [declaration.name?.getText(source)];
        for (const method of names) {
          if (!method || !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)) continue;
          const key = `${method} ${route}`;
          seen.add(key);
          assert.ok(policy[key], `Missing API policy: ${key}`);
          if (policy[key].startsWith("excluded: ")) continue;
          assert.ok(ts.isVariableDeclaration(declaration) && declaration.initializer && ts.isCallExpression(declaration.initializer), `${key} must use withActivity`);
          const call = declaration.initializer;
          assert.equal(call.expression.getText(source), "withActivity", key);
          assert.equal((call.arguments[0] as ts.StringLiteral).text, route, key);
          assert.equal((call.arguments[1] as ts.StringLiteral).text, method, key);
        }
      }
    }
  }
  // Excluded local-only files may be absent in a clean checkout.
  for (const [key, value] of Object.entries(policy)) if (value === "tracked") assert.ok(seen.has(key), `Stale policy: ${key}`);
});

test("every database table and scalar field has a reviewed policy; SQL allow lists match", () => {
  const schema = read("prisma/schema.prisma");
  const policy = JSON.parse(read("src/lib/activity/field-policy.json")) as Record<string, { values: string[]; changeOnly: string[] }>;
  const exclusions = JSON.parse(read("src/lib/activity/table-exclusions.json"));
  const migration = readdirSync(path.join(root, "prisma/migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    .map((name) => read(`prisma/migrations/${name}/migration.sql`)).join("\n");
  const ignored = new Set("id created_at updated_at created_by updated_by deleted_by normalized_name source_fingerprint validation_errors".split(" "));
  const enums = new Set([...schema.matchAll(/enum (\w+) \{/g)].map((m) => m[1]));
  for (const [, , body] of schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
    const table = /@@map\("(.*?)"\)/.exec(body)![1];
    if (table.startsWith("activity_")) continue;
    assert.ok(policy[table] || exclusions[table], `Table needs policy: ${table}`);
    if (!policy[table]) continue;
    const columns: string[] = [];
    for (const line of body.split("\n")) {
      const match = /^\s*(\w+)\s+(\w+)[?\[\]]*\s*(.*)/.exec(line);
      if (!match || line.includes("@relation")) continue;
      const [, field, type, tail] = match;
      if (!enums.has(type) && !["String", "Int", "Boolean", "DateTime", "Decimal", "Json", "Bytes", "Float", "BigInt"].includes(type)) continue;
      const column = /@map\("(.*?)"\)/.exec(tail)?.[1] ?? field;
      if (!ignored.has(column)) columns.push(column);
    }
    assert.deepEqual([...policy[table].values, ...policy[table].changeOnly].sort(), columns.sort(), `${table}: review new fields`);
    const pattern = new RegExp(`ON ${table}\\s+FOR EACH ROW EXECUTE FUNCTION capture_activity_change\\('([^']*)'\\)`);
    const trigger = [...migration.matchAll(new RegExp(pattern.source, "g"))].at(-1);
    assert.ok(trigger, `Missing trigger: ${table}`);
    assert.deepEqual(JSON.parse(trigger[1]), policy[table].values);
    for (const field of policy[table].values) assert.ok(!/(token|password|secret|phone|birth|content|note|feedback)/.test(field), `Unexpected sensitive allow-list entry: ${table}.${field}`);
  }
});
