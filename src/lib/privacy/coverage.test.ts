import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privacyFields } from "./fields";
import activityPolicy from "../activity/field-policy.json" with { type: "json" };
import inventory from "./inventory.json" with { type: "json" };

test("every persisted scalar has an explicit encryption classification", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  for (const [, model, body] of schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
    const expected = inventory[model as keyof typeof inventory];
    assert.ok(expected, `Classify new model ${model}`);
    const seen: string[] = [];
    for (const [, field, type] of body.matchAll(/^  (\w+)\s+(\w+)[?\[\]]*/gm)) {
      if (!["String", "Json", "Bytes", "DateTime", "Int", "Boolean", "Decimal", "Float", "BigInt"].includes(type) || /(?:PiiIndex|Encrypted)$/.test(field)) continue;
      seen.push(field);
      const classification = (expected as Record<string, string>)[field];
      assert.ok(classification, `Review new persisted field ${model}.${field}`);
      assert.equal(classification === "encrypted", !!privacyFields[model]?.fields[field], `${model}.${field}`);
    }
    assert.deepEqual(seen.sort(), Object.keys(expected).sort());
  }
});

// Classification alone is not enough: later activity migrations must not restore
// protected values into the audit allow-list. activity/coverage also checks SQL.
test("encrypted fields never enter activity value allow-lists", () => {
  for (const policy of Object.values(privacyFields)) {
    const activity = (activityPolicy as Record<string, { values: string[] }>)[policy.table];
    if (!activity) continue;
    for (const field of Object.values(policy.fields)) {
      assert.ok(!activity.values.includes(field.column), `${policy.table}.${field.column}`);
    }
  }
});
