import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

test("Next의 React·Hooks·접근성·TypeScript 검사는 호환 처리 후에도 실제 위반을 탐지한다", async () => {
  const eslint = new ESLint();
  const fixtures = [
    { rule: "react/display-name", code: 'import { memo } from "react"; export default memo(() => <div />);' },
    { rule: "react-hooks/rules-of-hooks", code: 'import { useState } from "react"; export function Example({ flag }: { flag: boolean }) { if (flag) useState(0); return <div />; }' },
    { rule: "jsx-a11y/alt-text", code: 'export function Example() { return <img src="/fixture.png" />; }' },
    { rule: "@typescript-eslint/no-explicit-any", code: 'export function Example(value: any) { return value; }' }
  ];
  for (const fixture of fixtures) {
    const [result] = await eslint.lintText(fixture.code, { filePath: "src/eslint-compat-fixture.tsx" });
    assert.equal(result.fatalErrorCount, 0);
    assert.ok(result.messages.some((message) => message.ruleId === fixture.rule), `${fixture.rule} must stay enabled`);
  }
});
