import { getHubBotKnowledge } from "./knowledgeSource";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TOKENS = 2048;
const MAX_HISTORY_TURNS = 10;

const FALLBACK_REPLY = "지금은 답변을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.";
const NOT_CONFIGURED_REPLY = "챗봇이 아직 설정되지 않았습니다. 운영 담당자에게 문의해 주세요.";

export interface HubBotChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessagesResponse {
  content?: AnthropicContentBlock[];
}

export async function askHubBot(question: string, history: HubBotChatTurn[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NOT_CONFIGURED_REPLY;
  }

  const model = process.env.HUB_BOT_MODEL?.trim() || DEFAULT_MODEL;
  const knowledge = await getHubBotKnowledge().catch(() => "");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        thinking: { type: "disabled" },
        system: buildSystemPrompt(knowledge),
        messages: [...history.slice(-MAX_HISTORY_TURNS), { role: "user", content: question }]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      console.error(`hubBot: Claude API 호출 실패 (${response.status}) ${await response.text()}`);
      return FALLBACK_REPLY;
    }

    const payload = (await response.json()) as AnthropicMessagesResponse;
    const text = payload.content?.find((block) => block.type === "text")?.text?.trim();
    return text || FALLBACK_REPLY;
  } catch (error) {
    console.error("hubBot: Claude API 호출 중 오류", error);
    return FALLBACK_REPLY;
  } finally {
    clearTimeout(timeout);
  }
}

interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

function buildSystemPrompt(knowledge: string): AnthropicSystemBlock[] {
  const instructions = [
    "당신은 hub-om 사이트에 로그인한 OM(운영매니저) 구성원을 돕는 업무 챗봇입니다.",
    "아래 '참고 자료'에 있는 전체 운영 프로세스와 매뉴얼 내용만 근거로 답변합니다.",
    "참고 자료에 없는 내용, 특히 실제 고객사 매출/계약금액, 강사 개인정보, 특정 운영 건의 실제 데이터는 답변하지 않고 '이 챗봇의 답변 범위가 아닙니다. 담당자에게 문의해 주세요.'라고 안내합니다.",
    "확실하지 않으면 모른다고 말하고, 추측하지 않습니다.",
    "답변은 한국어로 간결하게 작성합니다."
  ].join("\n");

  return [
    { type: "text", text: instructions },
    {
      type: "text",
      text: `## 참고 자료\n${knowledge || "(참고 자료를 불러오지 못했습니다.)"}`,
      // 지식은 knowledgeSource.ts의 TTL(기본 15분) 동안 바이트 단위로 동일하므로,
      // 여기 캐시 breakpoint를 두면 그 사이 반복 질문은 입력 토큰 비용이 대폭 줄어든다.
      cache_control: { type: "ephemeral" }
    }
  ];
}
