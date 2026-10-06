import assert from "node:assert/strict";
import test from "node:test";

import { resolveChannel } from "@/lib/slack/notifySlack";

test("손상된 요청 파트명과 매핑 키를 같은 채널로 연결한다", () => {
  const previous = process.env.SLACK_OM_REQUEST_CHANNELS;
  const damage = (value: string) => Buffer.from(value, "utf8").toString("latin1");

  try {
    process.env.SLACK_OM_REQUEST_CHANNELS = `${damage(damage("1파트"))}:test-channel`;
    assert.equal(resolveChannel(damage(damage("1파트"))), "test-channel");
  } finally {
    if (previous === undefined) delete process.env.SLACK_OM_REQUEST_CHANNELS;
    else process.env.SLACK_OM_REQUEST_CHANNELS = previous;
  }
});
