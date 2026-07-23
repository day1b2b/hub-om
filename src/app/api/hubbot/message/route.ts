import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { askHubBot, type HubBotChatTurn } from "@/lib/hubBot/claudeClient";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_LENGTH = 20;

export async function POST(request: Request) {
  await requireWorkspaceSession();

  const body = (await request.json().catch(() => ({}))) as {
    message?: unknown;
    history?: unknown;
  };

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ ok: false, error: "질문을 입력해 주세요." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ ok: false, error: "질문이 너무 깁니다." }, { status: 400 });
  }

  const history = parseHistory(body.history);

  const reply = await askHubBot(message, history);
  return NextResponse.json({ ok: true, reply });
}

function parseHistory(value: unknown): HubBotChatTurn[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((turn): turn is { role: unknown; content: unknown } => typeof turn === "object" && turn !== null)
    .filter(
      (turn): turn is HubBotChatTurn =>
        (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string" && turn.content.trim() !== ""
    )
    .slice(-MAX_HISTORY_LENGTH);
}
