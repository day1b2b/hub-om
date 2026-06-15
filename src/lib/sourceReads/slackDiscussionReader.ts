import type { OperationSession } from "@/lib/data/operationTypes";
import type { DiscussionReference, SourceReadIssue, SourceReadResult } from "./sourceReadTypes";

const SLACK_API_BASE_URL = "https://slack.com/api";
const DEFAULT_MAX_SEARCH_RESULTS = 8;
const DEFAULT_THREAD_LIMIT = 20;
const DEFAULT_LOOKBACK_DAYS = 120;
const DEFAULT_HISTORY_PAGE_LIMIT = 5;
const DEFAULT_HISTORY_PAGE_SIZE = 100;
const DEFAULT_THREAD_CANDIDATE_LIMIT = 50;
const DEFAULT_WINDOW_MONTHS_BEFORE = 3;
const DEFAULT_WINDOW_MONTHS_AFTER = 2;

interface SlackDiscussionConfig {
  afterDate?: string;
  botToken: string;
  channels: string[];
  companyOnlyChannels: string[];
  reportChannels: string[];
  teamChannels: Map<string, string[]>;
  aiSummaryEnabled: boolean;
  aiSummaryModel: string;
  aiSummaryTimeoutMs: number;
  openAiApiKey: string;
  openAiBaseUrl: string;
  historyPageLimit: number;
  historyPageSize: number;
  lookbackDays: number;
  maxSearchResults: number;
  searchToken: string;
  threadCandidateLimit: number;
  threadLimit: number;
  windowMonthsAfter: number;
  windowMonthsBefore: number;
}

interface SlackHistoryResponse {
  error?: string;
  messages?: SlackThreadMessage[];
  ok?: boolean;
  response_metadata?: {
    next_cursor?: string;
  };
}

interface SlackSearchResponse {
  error?: string;
  messages?: {
    matches?: SlackSearchMatch[];
  };
  ok?: boolean;
}

interface SlackSearchMatch {
  channel?: {
    id?: string;
    name?: string;
  };
  permalink?: string;
  text?: string;
  threadMessages?: SlackThreadMessage[];
  ts?: string;
}

interface SlackRepliesResponse {
  error?: string;
  messages?: SlackThreadMessage[];
  ok?: boolean;
}

interface SlackPermalinkResponse {
  error?: string;
  ok?: boolean;
  permalink?: string;
}

interface SlackThreadMessage {
  reply_count?: number;
  text?: string;
  thread_ts?: string;
  ts?: string;
  user?: string;
}

interface SlackUserInfoResponse {
  error?: string;
  ok?: boolean;
  user?: {
    name?: string;
    profile?: {
      display_name?: string;
      real_name?: string;
    };
    real_name?: string;
  };
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

const slackUserNameCache = new Map<string, string[]>();

export function hasSlackDiscussionConfig() {
  return Boolean(process.env.SLACK_BOT_TOKEN?.trim() || process.env.SLACK_SEARCH_TOKEN?.trim());
}

export async function readSlackOperationDiscussionReferences(
  operation: OperationSession
): Promise<SourceReadResult<DiscussionReference>> {
  const readAt = new Date().toISOString();
  const config = readSlackDiscussionConfig();
  const issues = validateSlackDiscussionConfig(config);

  if (issues.length > 0) {
    return {
      source: "discussion",
      status: "failed",
      readAt,
      items: [],
      issues
    };
  }

  try {
    const result = config.botToken
      ? await readChannelHistoryDiscussionReferences(operation, config)
      : await readSearchDiscussionReferences(operation, config);

    return {
      source: "discussion",
      status: result.issues.length > 0 ? "partial" : "ok",
      readAt,
      items: result.items,
      issues: result.issues
    };
  } catch {
    return {
      source: "discussion",
      status: "failed",
      readAt,
      items: [],
      issues: [
        {
          code: "slack_discussion_read_failed",
          message: "Slack discussions could not be read.",
          recoverable: true
        }
      ]
    };
  }
}

export async function readSlackOperationReportReferences(
  operation: OperationSession
): Promise<SourceReadResult<DiscussionReference>> {
  const readAt = new Date().toISOString();
  const config = readSlackDiscussionConfig();
  const issues = validateSlackReportConfig(config);

  if (issues.length > 0) {
    return {
      source: "discussion",
      status: "disabled",
      readAt,
      items: [],
      issues
    };
  }

  try {
    const window = buildOperationDiscussionWindow(operation, config);
    const channelResults = await Promise.all(
      config.reportChannels.map((channelId) => readMatchingReportMessages(channelId, operation, window, config))
    );
    const matches = dedupeSlackMatches(channelResults.flatMap((result) => result.matches))
      .slice(0, 3);
    const references = await Promise.all(
      matches.map((match) => buildDiscussionReference(operation, match, config))
    );

    return {
      source: "discussion",
      status: channelResults.some((result) => result.issues.length > 0) ? "partial" : "ok",
      readAt,
      items: references.filter((item): item is DiscussionReference => item !== null),
      issues: channelResults.flatMap((result) => result.issues)
    };
  } catch {
    return {
      source: "discussion",
      status: "failed",
      readAt,
      items: [],
      issues: [
        {
          code: "slack_report_read_failed",
          message: "Slack lecture reports could not be read.",
          recoverable: true
        }
      ]
    };
  }
}

function readSlackDiscussionConfig(): SlackDiscussionConfig {
  return {
    afterDate: normalizeDateInput(process.env.SLACK_DISCUSSION_AFTER_DATE),
    botToken: process.env.SLACK_BOT_TOKEN?.trim() ?? "",
    channels: parseCsv(process.env.SLACK_DISCUSSION_CHANNELS),
    companyOnlyChannels: parseCsv(process.env.SLACK_DISCUSSION_COMPANY_ONLY_CHANNELS),
    reportChannels: parseCsv(process.env.SLACK_REPORT_CHANNELS),
    teamChannels: parseTeamChannels(process.env.SLACK_DISCUSSION_TEAM_CHANNELS),
    aiSummaryEnabled: parseBoolean(process.env.SLACK_DISCUSSION_AI_SUMMARY_ENABLED, false),
    aiSummaryModel: process.env.SLACK_DISCUSSION_AI_SUMMARY_MODEL?.trim() || "gpt-4o-mini",
    aiSummaryTimeoutMs: parsePositiveInteger(process.env.SLACK_DISCUSSION_AI_SUMMARY_TIMEOUT_MS, 8000),
    openAiApiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
    openAiBaseUrl: normalizeOpenAiBaseUrl(process.env.OPENAI_BASE_URL),
    historyPageLimit: parsePositiveInteger(process.env.SLACK_DISCUSSION_HISTORY_PAGE_LIMIT, DEFAULT_HISTORY_PAGE_LIMIT),
    historyPageSize: parsePositiveInteger(process.env.SLACK_DISCUSSION_HISTORY_PAGE_SIZE, DEFAULT_HISTORY_PAGE_SIZE),
    lookbackDays: parsePositiveInteger(process.env.SLACK_DISCUSSION_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS),
    maxSearchResults: parsePositiveInteger(process.env.SLACK_DISCUSSION_MAX_SEARCH_RESULTS, DEFAULT_MAX_SEARCH_RESULTS),
    searchToken: process.env.SLACK_SEARCH_TOKEN?.trim() ?? "",
    threadCandidateLimit: parsePositiveInteger(
      process.env.SLACK_DISCUSSION_THREAD_CANDIDATE_LIMIT,
      DEFAULT_THREAD_CANDIDATE_LIMIT
    ),
    threadLimit: parsePositiveInteger(process.env.SLACK_DISCUSSION_THREAD_LIMIT, DEFAULT_THREAD_LIMIT),
    windowMonthsAfter: parsePositiveInteger(process.env.SLACK_DISCUSSION_WINDOW_MONTHS_AFTER, DEFAULT_WINDOW_MONTHS_AFTER),
    windowMonthsBefore: parsePositiveInteger(process.env.SLACK_DISCUSSION_WINDOW_MONTHS_BEFORE, DEFAULT_WINDOW_MONTHS_BEFORE)
  };
}

function validateSlackDiscussionConfig(config: SlackDiscussionConfig): SourceReadIssue[] {
  const configuredChannels = getConfiguredSlackChannels(config);

  if (config.botToken && configuredChannels.length > 0 && configuredChannels.every(isSlackChannelId)) {
    return [];
  }

  if (config.botToken && configuredChannels.length === 0) {
    return [
      {
        code: "slack_discussion_channels_missing",
        message: "Slack bot token mode requires SLACK_DISCUSSION_CHANNELS.",
        recoverable: true
      }
    ];
  }

  if (config.botToken && configuredChannels.some((channel) => !isSlackChannelId(channel))) {
    return [
      {
        code: "slack_discussion_channel_ids_required",
        message: "Slack bot token mode requires channel IDs in SLACK_DISCUSSION_CHANNELS.",
        recoverable: true
      }
    ];
  }

  if (config.searchToken) {
    return [];
  }

  return [
    {
      code: "slack_search_token_missing",
      message: "Slack discussion reader is not configured.",
      recoverable: true
    }
  ];
}

function validateSlackReportConfig(config: SlackDiscussionConfig): SourceReadIssue[] {
  if (!config.botToken || config.reportChannels.length === 0) {
    return [
      {
        code: "slack_report_reader_not_configured",
        message: "Slack report reader is not configured.",
        recoverable: true
      }
    ];
  }

  if (config.reportChannels.some((channel) => !isSlackChannelId(channel))) {
    return [
      {
        code: "slack_report_channel_ids_required",
        message: "Slack report reader requires channel IDs in SLACK_REPORT_CHANNELS.",
        recoverable: true
      }
    ];
  }

  return [];
}

async function readChannelHistoryDiscussionReferences(operation: OperationSession, config: SlackDiscussionConfig) {
  const window = buildOperationDiscussionWindow(operation, config);
  const channels = getOperationSlackChannels(operation, config);
  const channelResults = await Promise.all(
    channels.map((channelId) => readMatchingChannelMessages(channelId, operation, window, config))
  );
  const matches = dedupeSlackMatches(channelResults.flatMap((result) => result.matches))
    .slice(0, config.maxSearchResults);
  const fallbackMatches = matches.length === 0 && shouldAlwaysSurfaceSlackThread(operation)
    ? await readCompanyOnlyFallbackMatches(operation, window, config)
    : [];
  const references = await Promise.all(
    [...matches, ...fallbackMatches].map((match) => buildDiscussionReference(operation, match, config))
  );

  return {
    issues: channelResults.flatMap((result) => result.issues),
    items: references.filter((item): item is DiscussionReference => item !== null)
  };
}

async function readCompanyOnlyFallbackMatches(
  operation: OperationSession,
  window: SlackDiscussionWindow,
  config: SlackDiscussionConfig
) {
  if (config.companyOnlyChannels.length === 0) {
    return [];
  }

  const fallbackResults = await Promise.all(
    config.companyOnlyChannels.map((channelId) => readCompanyOnlyFallbackChannel(channelId, operation, window, config))
  );

  return dedupeSlackMatches(fallbackResults.flat()).slice(0, 1);
}

function getOperationSlackChannels(operation: OperationSession, config: SlackDiscussionConfig) {
  const teamKey = operation.sourceTeam ? normalizeTeamKey(operation.sourceTeam) : "";
  const teamChannels = teamKey ? config.teamChannels.get(teamKey) ?? [] : [];
  return teamChannels.length > 0 ? teamChannels : config.channels;
}

async function readMatchingChannelMessages(
  channelId: string,
  operation: OperationSession,
  window: SlackDiscussionWindow,
  config: SlackDiscussionConfig
) {
  const history = await readChannelHistory(channelId, window, config);
  const candidateLimit = getOperationThreadCandidateLimit(operation, config);
  const candidates = getThreadCandidateMessages(history.messages, operation)
    .sort((a, b) => scoreCandidateMessage(b, operation) - scoreCandidateMessage(a, operation))
    .slice(0, candidateLimit);
  const matches = await filterMatchingThreads(channelId, candidates, operation, config);

  return {
    issues: history.issues,
    matches
  };
}

async function readCompanyOnlyFallbackChannel(
  channelId: string,
  operation: OperationSession,
  window: SlackDiscussionWindow,
  config: SlackDiscussionConfig
) {
  const history = await readChannelHistory(channelId, window, config);
  const candidates = getThreadCandidateMessages(history.messages, operation)
    .sort((a, b) => scoreCandidateMessage(b, operation) - scoreCandidateMessage(a, operation))
    .slice(0, getOperationThreadCandidateLimit(operation, config));

  return findFallbackThreads(channelId, candidates, operation, config);
}

async function readMatchingReportMessages(
  channelId: string,
  operation: OperationSession,
  window: SlackDiscussionWindow,
  config: SlackDiscussionConfig
) {
  const history = await readChannelHistory(channelId, window, config);
  const candidateLimit = getOperationThreadCandidateLimit(operation, config);
  const candidates = history.messages
    .filter((message) => isReportCandidateMessage(message, operation))
    .sort((a, b) => scoreReportCandidateMessage(b, operation) - scoreReportCandidateMessage(a, operation))
    .slice(0, candidateLimit);
  const matches = await filterMatchingReportThreads(channelId, candidates, operation, config);

  return {
    issues: history.issues,
    matches
  };
}

interface SlackDiscussionWindow {
  latest: string;
  oldest: string;
}

async function readChannelHistory(channelId: string, window: SlackDiscussionWindow, config: SlackDiscussionConfig) {
  const messages: SlackThreadMessage[] = [];
  const issues: SourceReadIssue[] = [];
  let cursor = "";

  for (let page = 0; page < config.historyPageLimit; page += 1) {
    const payload = await callSlackApi<SlackHistoryResponse>("conversations.history", config.botToken, {
      channel: channelId,
      cursor,
      inclusive: "true",
      latest: window.latest,
      limit: String(config.historyPageSize),
      oldest: window.oldest
    });

    if (!payload.ok) {
      issues.push(buildSlackIssue("slack_history_failed", payload.error));
      break;
    }

    messages.push(...(payload.messages ?? []));
    cursor = payload.response_metadata?.next_cursor ?? "";

    if (!cursor) {
      break;
    }
  }

  return { issues, messages };
}

async function readSearchDiscussionReferences(operation: OperationSession, config: SlackDiscussionConfig) {
  const queries = buildSlackQueries(operation, config);
  const searchResults = await Promise.all(queries.map((query) => searchSlackMessages(query, config)));
  const matches = dedupeSlackMatches(searchResults.flatMap((result) => result.matches))
    .slice(0, config.maxSearchResults);
  const references = await Promise.all(
    matches.map((match) => buildDiscussionReference(operation, match, config))
  );

  return {
    issues: searchResults.flatMap((result) => result.issues),
    items: references.filter((item): item is DiscussionReference => item !== null)
  };
}

function buildSlackQueries(operation: OperationSession, config: SlackDiscussionConfig) {
  const afterDate = config.afterDate ?? formatSlackAfterDate(config.lookbackDays);
  const courseName = quoteSlackSearch(operation.courseName);
  const companyName = quoteSlackSearch(operation.companyName);
  const people = [operation.om, operation.ld].map(quoteSlackSearch).filter(Boolean);
  const baseQueries = [
    `${courseName} after:${afterDate}`,
    ...people.map((person) => `${companyName} ${person} after:${afterDate}`)
  ].filter((query) => query.trim() !== `after:${afterDate}`);

  const searchChannels = config.channels.filter((channel) => !isSlackChannelId(channel));
  const queries = searchChannels.length > 0
    ? baseQueries.flatMap((query) => searchChannels.map((channel) => `${query} in:${formatSlackChannelFilter(channel)}`))
    : baseQueries;

  return [...new Set(queries)].slice(0, 3);
}

async function searchSlackMessages(query: string, config: SlackDiscussionConfig) {
  const payload = await callSlackApi<SlackSearchResponse>("search.messages", config.searchToken, {
    count: String(config.maxSearchResults),
    highlight: "false",
    query,
    sort: "timestamp",
    sort_dir: "desc"
  });

  if (!payload.ok) {
    return {
      issues: [buildSlackIssue("slack_search_failed", payload.error)],
      matches: []
    };
  }

  return {
    issues: [],
    matches: filterSlackMatchesByChannel(payload.messages?.matches ?? [], config.channels)
  };
}

async function buildDiscussionReference(
  operation: OperationSession,
  match: SlackSearchMatch,
  config: SlackDiscussionConfig
): Promise<DiscussionReference | null> {
  const channelId = match.channel?.id;
  const ts = match.ts;

  if (!channelId || !ts) {
    return null;
  }

  const thread = match.threadMessages ? { messages: match.threadMessages } : await readSlackThread(channelId, ts, config);
  const messages = thread.messages.length > 0 ? thread.messages : [{ text: match.text, ts }];
  const sourceUrl = match.permalink ?? await readSlackPermalink(channelId, ts, config);
  const summary = await formatThreadSummary(messages, config, operation);
  const title = buildThreadTitle(operation, summary);

  return {
    sourceMessageId: `${channelId}-${ts}`,
    operationKey: operation.operationId,
    title,
    occurredAt: slackTsToIso(ts),
    sourceKind: "slack",
    sourceLabel: "Slack",
    sourceUrl,
    summary
  };
}

async function readSlackThread(channelId: string, ts: string, config: SlackDiscussionConfig) {
  const token = config.botToken || config.searchToken;
  const payload = await callSlackApi<SlackRepliesResponse>("conversations.replies", token, {
    channel: channelId,
    inclusive: "true",
    limit: String(config.threadLimit),
    ts
  });

  if (!payload.ok) {
    return {
      issues: [buildSlackIssue("slack_thread_read_failed", payload.error)],
      messages: []
    };
  }

  return {
    issues: [],
    messages: payload.messages ?? []
  };
}

async function readSlackPermalink(channelId: string, ts: string, config: SlackDiscussionConfig) {
  const token = config.botToken || config.searchToken;

  try {
    const payload = await callSlackApi<SlackPermalinkResponse>("chat.getPermalink", token, {
      channel: channelId,
      message_ts: ts
    });

    if (payload.ok && payload.permalink) {
      return payload.permalink;
    }
  } catch {
    // Fall through to Slack app deep link.
  }

  return buildSlackAppUrl(channelId, ts);
}

async function formatThreadSummary(
  messages: SlackThreadMessage[],
  config: SlackDiscussionConfig,
  operation: OperationSession
) {
  const displayMessages = (await Promise.all(
    messages.map(async (message) => {
      const text = await formatSlackDisplayText(message.text ?? "", config);

      if (!text) {
        return null;
      }

      const names = message.user ? await readSlackUserNames(message.user, config) : [];
      return {
        speaker: names[0] ?? "",
        text
      };
    })
  )).filter((message): message is { speaker: string; text: string } => message !== null);

  return summarizeThreadOutcome(displayMessages, operation, config);
}

async function summarizeThreadOutcome(
  messages: Array<{ speaker: string; text: string }>,
  operation: OperationSession,
  config: SlackDiscussionConfig
) {
  const aiSummary = await readAiThreadSummary(messages, operation, config);

  if (aiSummary) {
    return aiSummary;
  }

  const fullText = messages.map((message) => message.text).join(" ");
  const summaryLines = buildStructuredSummary(fullText);
  const structuredSummary = formatSummaryLines(summaryLines);

  if (structuredSummary) {
    return structuredSummary;
  }

  const fallbackLines = buildMessageBackedSummary(messages, operation);
  const fallbackSummary = formatSummaryLines(fallbackLines);

  if (fallbackSummary) {
    return fallbackSummary;
  }

  return "- 원문 확인: 자동 요약에 충분한 구체 결정이나 후속 조치가 없어 Slack 원문 확인이 필요합니다.";
}

async function readAiThreadSummary(
  messages: Array<{ speaker: string; text: string }>,
  operation: OperationSession,
  config: SlackDiscussionConfig
) {
  if (!config.aiSummaryEnabled || !config.openAiApiKey || messages.length === 0) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiSummaryTimeoutMs);

  try {
    const payload = await fetch(`${config.openAiBaseUrl}/chat/completions`, {
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: [
              "당신은 B2B 교육 운영 매니저입니다.",
              "Slack 스레드를 읽고 상세페이지 카드에 들어갈 운영 요약만 작성합니다.",
              "원문 인용, 감탄사, Slack 사용자 ID, 불확실한 추측은 쓰지 않습니다.",
              "반드시 한국어 bullet 2~4개만 출력하고 각 줄은 '- '로 시작합니다.",
              "가능하면 라벨은 요지, 결론, 후속, 주의를 사용합니다.",
              "결론이나 후속 조치가 원문에 없으면 해당 라벨은 생략합니다.",
              "각 bullet에는 변경 대상, 요청 내용, 결정, 담당자 행동 중 하나 이상의 구체 정보가 있어야 합니다.",
              "'확인한 내용을 공유했습니다', '요청 사항을 확인했습니다'처럼 확인/공유 사실만 반복하는 문장은 쓰지 않습니다.",
              "라벨 뒤 내용은 짧은 구문으로 쓰고, '-다', '-습니다', '-합니다' 같은 문장 종결형은 피합니다."
            ].join(" ")
          },
          {
            role: "user",
            content: buildAiSummaryPrompt(messages, operation)
          }
        ],
        model: config.aiSummaryModel,
        temperature: 0.2
      }),
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      signal: controller.signal
    });

    if (!payload.ok) {
      return null;
    }

    const data = await payload.json() as OpenAIChatCompletionResponse;
    return normalizeAiSummary(data.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildAiSummaryPrompt(messages: Array<{ speaker: string; text: string }>, operation: OperationSession) {
  const transcript = messages
    .slice(0, 24)
    .map((message) => `${message.speaker || "작성자"}: ${message.text}`)
    .join("\n")
    .slice(0, 7000);

  return [
    "[과정 정보]",
    `기업: ${operation.companyName}`,
    `과정명: ${operation.courseName}`,
    `OM: ${operation.om || "미지정"}`,
    `LD: ${operation.ld || "미지정"}`,
    `기간: ${operation.startDate} ~ ${operation.endDate}`,
    `강사: ${operation.instructors || "미기재"}`,
    "",
    "[Slack 스레드]",
    transcript,
    "",
    "[작성 기준]",
    "- 이 대화가 어떤 운영 이슈였는지 한눈에 알 수 있게 씁니다.",
    "- 최종 결정, 고객 확인 내용, 후속 조치가 원문에 구체적으로 있으면 분리해서 씁니다.",
    "- 확인/공유/전달했다는 사실만 있고 무엇을 확인했는지 불명확하면 쓰지 않습니다.",
    "- 자료, 일정, 강사, 비용, 피드백, 회차처럼 실제 운영자가 찾을 수 있는 대상을 포함합니다.",
    "- 라벨 뒤 내용은 20자 안팎의 짧은 구문으로 씁니다. 예: 교안 공유, 4시간 기준 지급, 조한준 강사",
    "- 원문 일부를 그대로 베끼지 말고 의미를 정리합니다.",
    "- 근거가 부족한 내용은 쓰지 않습니다."
  ].join("\n");
}

function normalizeAiSummary(value: string) {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/, "- "))
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/\s+/g, " "))
    .filter(isUsefulSummaryLine);

  if (lines.length === 0) {
    return null;
  }

  return lines.slice(0, 4).join("\n");
}

function formatSummaryLines(lines: string[]) {
  const usefulLines = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/, ""))
    .map((line) => `- ${line}`)
    .filter(isUsefulSummaryLine)
    .slice(0, 4);

  if (usefulLines.length === 0) {
    return null;
  }

  return usefulLines.join("\n");
}

function isUsefulSummaryLine(line: string) {
  return !isLowSignalSummaryLine(line) && hasConcreteSummarySignal(line);
}

function isLowSignalSummaryLine(line: string) {
  const text = stripSummaryLabel(line);

  return [
    /^(확인\s*필요|추가\s*확인\s*필요|확인이\s*필요|원문\s*확인\s*필요)\.?$/i,
    /확인한\s*내용을?\s*(?:팀에\s*)?공유했습니다\.?$/i,
    /^고객\/?담당자와?\s*확인한\s*내용을\s*팀에\s*공유했습니다\.?$/i,
    /^고객(?:\s*또는\s*담당자)?\s*요청\s*사항을\s*확인하고\s*대응\s*방향을\s*논의했습니다\.?$/i,
    /^고객\/?담당자의?\s*추가\s*회신\s*또는\s*재확인이\s*필요합니다\.?$/i,
    /^과정\s*운영에\s*필요한\s*자료나\s*전달\s*내용을\s*확인했습니다\.?$/i,
    /^공유된\s*.+자료를\s*과정\s*운영\s*자료나\s*보고\s*링크에서\s*확인(?:하면\s*됩니다|합니다)\.?$/i,
    /^.+관련\s*건은\s*스레드\s*안에서\s*정리된\s*상태입니다\.?$/i,
    /^해당\s*건은\s*스레드\s*안에서\s*정리된\s*상태입니다\.?$/i,
    /^고객\s*피드백\s*반영\s*논의입니다\.?$/i
  ].some((pattern) => pattern.test(text));
}

function hasConcreteSummarySignal(line: string) {
  const text = stripSummaryLabel(line);

  if (/\d/.test(text)) {
    return true;
  }

  return [
    /강사비|지급|정산|비용|계산서|입금/i,
    /일정|시간|장소|연기|취소|확정|조정/i,
    /자료|교안|콘텐츠|보고|링크|파일|문서/i,
    /피드백|난이도|실습|과제|핸즈온|진행\s*방식|속도|커리큘럼|강의\s*내용/i,
    /강사|섭외|시강|만족도/i,
    /회차|차수|분반|대상자|수강생|교육생/i,
    /변경|누락|문제|이슈|장애|리스크/i,
    /전달|반영|회신|요청|결정|확정|정리|마무리/i
  ].some((pattern) => pattern.test(text));
}

function stripSummaryLabel(line: string) {
  return line
    .replace(/^[-*]\s*/, "")
    .replace(/^(요지|결론|확인|후속|주의|맥락|원문\s*확인)\s*[:：]\s*/i, "")
    .trim();
}

function buildStructuredSummary(value: string) {
  const lines = [
    buildIssueSummary(value),
    buildDecisionSummary(value),
    buildFollowUpSummary(value),
    buildContextSummary(value)
  ].filter((line): line is string => Boolean(line));

  return [...new Set(lines)].slice(0, 4);
}

function buildIssueSummary(value: string) {
  if (/(4시간|4h|4 h)/i.test(value) && /(2시간|2h|2 h)/i.test(value)) {
    return "요지: 4시간→2시간 강사비";
  }

  if (/(피드백|반영)/i.test(value)) {
    const focus = getFeedbackFocus(value);
    return focus.length > 0
      ? `요지: 피드백 반영 - ${focus.join(", ")}`
      : "요지: 피드백 반영";
  }

  if (/(강의\s*내용\s*공유|내용\s*공유드립니다|강의보고|운영보고)/i.test(value)) {
    return "요지: 강의 내용/보고 공유";
  }

  if (/(자료|교안|콘텐츠|보고|공유|전달)/i.test(value)) {
    const materialFocus = getMaterialFocus(value);
    return materialFocus.length > 0 ? `요지: ${materialFocus.join(", ")} 공유` : null;
  }

  if (/(일정|시간|변경|연기|취소|확정|조정)/i.test(value)) {
    return "요지: 일정/시간 조정";
  }

  if (/(강사비|지급|비용|정산|입금|계산서)/i.test(value)) {
    return "요지: 비용/정산 기준";
  }

  if (/(강사|섭외|시강)/i.test(value)) {
    return "요지: 강사 섭외/시강";
  }

  if (/(고객|담당자|연락|전화|메일|요청)/i.test(value)) {
    const requestFocus = getRequestFocus(value);
    return requestFocus.length > 0 ? `요지: 고객 요청 - ${requestFocus.join(", ")}` : null;
  }

  return null;
}

function buildMessageBackedSummary(messages: Array<{ speaker: string; text: string }>, operation: OperationSession) {
  const selectedMessage = selectSummaryMessage(messages, operation);

  if (!selectedMessage) {
    return [];
  }

  const summary = truncateText(selectedMessage.text, 120);
  const context = buildMessageContextSummary(messages.map((message) => message.text).join(" "));

  return [
    `요지: ${summary}`,
    context
  ].filter((line): line is string => Boolean(line));
}

function selectSummaryMessage(messages: Array<{ speaker: string; text: string }>, operation: OperationSession) {
  const operationTokens = [
    ...tokenizeMatchText(operation.companyName),
    ...tokenizeMatchText(operation.courseName),
    ...[operation.om, operation.ld].flatMap(tokenizePersonName)
  ];

  return messages
    .map((message) => ({
      ...message,
      text: normalizeSummaryText(message.text)
    }))
    .filter((message) => message.text.length >= 12)
    .filter((message) => !isLowSignalThreadText(message.text, operationTokens))
    .filter((message) => scoreSummaryMessage(message.text) > 0)
    .sort((a, b) => scoreSummaryMessage(b.text) - scoreSummaryMessage(a.text))[0] ?? null;
}

function normalizeSummaryText(value: string) {
  return value
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[-·*]\s*/, "")
    .trim();
}

function isLowSignalThreadText(value: string, operationTokens: string[]) {
  const significantText = stripLowSignalSlackText(value, operationTokens);

  return (
    significantText.length < 10 ||
    isRoutingOnlySlackText(significantText) ||
    /^(확인했습니다|확인했습니다\.|넵|네|감사합니다|공유드립니다|전달드립니다)$/i.test(value.trim())
  );
}

function stripLowSignalSlackText(value: string, operationTokens: string[]) {
  const normalizedValue = operationTokens.reduce(
    (nextValue, token) => nextValue.replaceAll(token, ""),
    normalizeMatchText(
      value
        .replace(/@\S+/g, " ")
        .replace(/\([^)]*\)/g, " ")
        .replace(/^[^:：]{1,40}[:：]\s*/, " ")
        .replace(/[!~.。！？,，]+/g, " ")
    )
  );

  return normalizedValue
    .replace(/입니다|이에요|예요|님|외부|강의관리|운영논의|슬랙|slack/gi, "")
    .trim();
}

function isRoutingOnlySlackText(value: string) {
  return /^(입니다|안녕하세요|확인|공유|전달|문의|관련|건)$/i.test(value) || /^[가-힣a-z0-9]{2,8}$/.test(value);
}

function scoreSummaryMessage(value: string) {
  const keywordGroups = [
    /(결정|확정|정리|완료|마무리)/i,
    /(요청|문의|확인|회신|전달|공유)/i,
    /(일정|시간|장소|강사|비용|정산|자료|교안|피드백|만족도|보고)/i,
    /(이슈|문제|장애|변경|취소|연기)/i
  ];
  const signalScore = keywordGroups.reduce((score, pattern) => score + (pattern.test(value) ? 3 : 0), 0);

  if (signalScore === 0) {
    return 0;
  }

  return signalScore + Math.min(6, Math.floor(value.length / 30));
}

function buildMessageContextSummary(value: string) {
  const contexts = [
    ...extractInstructorNames(value).map((name) => `${name} 강사`),
    ...extractRoundLabels(value)
  ];

  if (contexts.length === 0) {
    return "";
  }

  return `맥락: ${[...new Set(contexts)].slice(0, 3).join(", ")}`;
}

function buildDecisionSummary(value: string) {
  if (/(4시간|4h|4 h)/i.test(value) && /(2시간|2h|2 h)/i.test(value)) {
    if (/(그대로|다 지급|전체 지급|4시간 그대로|4h 그대로)/i.test(value)) {
      return "결론: 4시간 기준 지급";
    }

    if (/(2시간으로|2h로|2시간 기준)/i.test(value)) {
      return "결론: 2시간 기준 협의";
    }

    return "결론: 지급 기준 확인 필요";
  }

  if (/(피드백|반영)/i.test(value) && /(전달|공유|반영|말씀|요청)/i.test(value)) {
    return "결론: 피드백 강사 전달";
  }

  return null;
}

function buildFollowUpSummary(value: string) {
  if (/(피드백|반영)/i.test(value) && /(강사|전달)/i.test(value)) {
    return "후속: 강사 반영 확인";
  }

  if (/(다시 연락|재확인|회신|답변|확인해보고|논의 해보고)/i.test(value) && !/(마무리|정리|확정)/i.test(value)) {
    return "후속: 고객 회신 확인";
  }

  return null;
}

function buildContextSummary(value: string) {
  const contexts = [
    ...extractInstructorNames(value).map((name) => `${name} 강사`),
    ...extractRoundLabels(value)
  ];

  if (contexts.length === 0) {
    return null;
  }

  return `맥락: ${[...new Set(contexts)].slice(0, 3).join(", ")}`;
}

function getFeedbackFocus(value: string) {
  const focus = [
    [/(자료|교안|콘텐츠)/i, "자료/교안"],
    [/(난이도|수준)/i, "난이도"],
    [/(실습|과제|핸즈온)/i, "실습 구성"],
    [/(진행|속도|시간)/i, "진행 방식"],
    [/(커리큘럼|내용|주제)/i, "강의 내용"]
  ] as const;

  return focus
    .filter(([pattern]) => pattern.test(value))
    .map(([, label]) => label)
    .slice(0, 3);
}

function getMaterialFocus(value: string) {
  const focus = [
    [/(교안|교재)/i, "교안"],
    [/(콘텐츠|자료)/i, "자료"],
    [/(강의\s*내용|강의보고|운영보고|보고)/i, "강의 내용/보고"],
    [/(링크|파일|문서|드라이브)/i, "링크/파일"]
  ] as const;

  return focus
    .filter(([pattern]) => pattern.test(value))
    .map(([, label]) => label)
    .slice(0, 3);
}

function getRequestFocus(value: string) {
  const focus = [
    [/(일정|시간|장소|변경|연기|취소)/i, "일정/시간"],
    [/(자료|교안|콘텐츠|강의\s*내용|보고)/i, "자료"],
    [/(강사|섭외|시강)/i, "강사"],
    [/(강사비|지급|비용|정산|계산서)/i, "비용/정산"],
    [/(피드백|난이도|실습|진행|커리큘럼)/i, "피드백 반영"]
  ] as const;

  return focus
    .filter(([pattern]) => pattern.test(value))
    .map(([, label]) => label)
    .slice(0, 3);
}

function extractInstructorNames(value: string) {
  const invalidNames = new Set([
    "강사님",
    "고객",
    "그럼",
    "내달라고",
    "담당자",
    "말씀",
    "반영",
    "안에서",
    "우리",
    "저희",
    "제가",
    "확인"
  ]);

  return [...value.matchAll(/([가-힣]{2,4})\s*강사(?:님)?/g)]
    .map((match) => match[1])
    .filter((name) => !invalidNames.has(name) && !name.endsWith("님"));
}

function extractRoundLabels(value: string) {
  return [...value.matchAll(/([가-힣A-Z0-9\s]+급\s*\d+\s*회차|\d+\s*회차)/gi)]
    .map((match) => cleanSlackText(match[1]))
    .filter((label) => label.length <= 24);
}

function buildThreadTitle(operation: OperationSession, summary: string) {
  const normalizedSummary = summary.replace(/^- /gm, "").replace(/\s+/g, " ").trim();
  const topic = normalizedSummary.includes("강사비") || normalizedSummary.includes("지급")
    ? "강사비/시간 조율"
    : normalizedSummary.includes("피드백")
      ? "피드백 반영 논의"
      : normalizedSummary.includes("강의 내용") || normalizedSummary.includes("보고")
        ? "강의 내용 공유"
      : normalizedSummary.includes("일정") || normalizedSummary.includes("시간")
        ? "일정/운영 시간 논의"
        : normalizedSummary.includes("자료") || normalizedSummary.includes("공유")
          ? "자료 공유 논의"
          : "운영 논의";

  return truncateText(`${operation.companyName} ${topic}`, 90);
}

async function formatSlackDisplayText(value: string, config: SlackDiscussionConfig) {
  const withUserNames = await replaceSlackUserMentions(value, config);
  return cleanSlackText(withUserNames);
}

async function replaceSlackUserMentions(value: string, config: SlackDiscussionConfig) {
  const mentionMatches = [...value.matchAll(/<@([UW][A-Z0-9]+)>/g)];
  let nextValue = value;

  for (const match of mentionMatches) {
    const userId = match[1];
    const names = await readSlackUserNames(userId, config);
    const displayName = names[0] ? `@${names[0]}` : "";
    nextValue = nextValue.replaceAll(match[0], displayName);
  }

  return nextValue;
}

function getThreadCandidateMessages(messages: SlackThreadMessage[], operation: OperationSession) {
  return messages.filter((message) => {
    const text = normalizeMatchText(message.text ?? "");
    const courseTokens = tokenizeMatchText(operation.courseName);
    const companyTokens = tokenizeMatchText(operation.companyName);
    const peopleTokens = [operation.om, operation.ld].flatMap(tokenizePersonName);
    const hasContext = companyTokens.some((token) => text.includes(token)) ||
      courseTokens.some((token) => text.includes(token));
    const hasPeople = peopleTokens.some((token) => text.includes(token)) ||
      /<@[UW][A-Z0-9]+>/.test(message.text ?? "");

    return Boolean(message.reply_count) || hasContext || hasPeople;
  });
}

function scoreCandidateMessage(message: SlackThreadMessage, operation: OperationSession) {
  const text = normalizeMatchText(message.text ?? "");
  const companyTokens = tokenizeMatchText(operation.companyName);
  const courseTokens = tokenizeMatchText(operation.courseName);
  const peopleTokens = [operation.om, operation.ld].flatMap(tokenizePersonName);
  let score = 0;

  if (companyTokens.some((token) => text.includes(token))) score += 12;
  if (courseTokens.some((token) => text.includes(token))) score += 5;
  score += peopleTokens.filter((token) => text.includes(token)).length * 4;
  if (/<@[UW][A-Z0-9]+>/.test(message.text ?? "")) score += 3;
  if (message.reply_count) score += 2;

  return score;
}

function getOperationThreadCandidateLimit(operation: OperationSession, config: SlackDiscussionConfig) {
  const startDate = parseDateOnly(operation.startDate);
  const endDate = parseDateOnly(operation.endDate);

  if (!startDate || !endDate) {
    return config.threadCandidateLimit;
  }

  const durationDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1);
  const scaledLimit = Math.ceil(durationDays / 7) * 25;

  return Math.max(config.threadCandidateLimit, Math.min(scaledLimit, 200));
}

async function filterMatchingThreads(
  channelId: string,
  messages: SlackThreadMessage[],
  operation: OperationSession,
  config: SlackDiscussionConfig
) {
  const matchResults = await Promise.all(
    messages.map(async (message) => ({
      threadMessages: await readThreadMessagesForMatch(channelId, message, config),
      message
    }))
  );

  return (await Promise.all(
    matchResults.map(async ({ message, threadMessages }) => ({
      isMatch: await matchesOperationThread(threadMessages, operation, config),
      message,
      threadMessages
    }))
  ))
    .filter((result) => result.isMatch)
    .map((result) => ({
      channel: { id: channelId },
      text: result.message.text,
      threadMessages: result.threadMessages,
      ts: result.message.thread_ts ?? result.message.ts
    }));
}

async function filterMatchingReportThreads(
  channelId: string,
  messages: SlackThreadMessage[],
  operation: OperationSession,
  config: SlackDiscussionConfig
) {
  const matchResults = await Promise.all(
    messages.map(async (message) => {
      const threadMessages = await readThreadMessagesForMatch(channelId, message, config);
      return {
        isMatch: matchesLectureReportThread(threadMessages, operation),
        message,
        threadMessages
      };
    })
  );

  return matchResults
    .filter((result) => result.isMatch)
    .map((result) => ({
      channel: { id: channelId },
      text: result.message.text,
      threadMessages: result.threadMessages,
      ts: result.message.thread_ts ?? result.message.ts
    }));
}

function isReportCandidateMessage(message: SlackThreadMessage, operation: OperationSession) {
  const text = normalizeMatchText(message.text ?? "");
  const courseTokens = tokenizeMatchText(operation.courseName);
  const instructorTokens = tokenizeInstructorText(operation.instructors);

  return courseTokens.some((token) => text.includes(token)) ||
    instructorTokens.some((token) => text.includes(token));
}

function scoreReportCandidateMessage(message: SlackThreadMessage, operation: OperationSession) {
  const text = normalizeMatchText(message.text ?? "");
  const courseTokens = tokenizeMatchText(operation.courseName);
  const instructorTokens = tokenizeInstructorText(operation.instructors);
  const companyTokens = tokenizeMatchText(operation.companyName);
  let score = 0;

  if (courseTokens.some((token) => text.includes(token))) score += 8;
  if (instructorTokens.some((token) => text.includes(token))) score += 10;
  if (companyTokens.some((token) => text.includes(token))) score += 4;
  if (message.reply_count) score += 2;

  return score;
}

function matchesLectureReportThread(messages: SlackThreadMessage[], operation: OperationSession) {
  const text = normalizeMatchText(messages.map((message) => message.text ?? "").join(" "));
  const courseTokens = tokenizeMatchText(operation.courseName);
  const instructorTokens = tokenizeInstructorText(operation.instructors);

  return courseTokens.some((token) => text.includes(token)) &&
    instructorTokens.some((token) => text.includes(token));
}

async function findFallbackThreads(
  channelId: string,
  messages: SlackThreadMessage[],
  operation: OperationSession,
  config: SlackDiscussionConfig
) {
  const companyTokens = tokenizeMatchText(operation.companyName);
  const fallbackCandidates = messages
    .filter((message) => companyTokens.some((token) => normalizeMatchText(message.text ?? "").includes(token)))
    .slice(0, Math.min(config.threadCandidateLimit, 8));
  const threadResults = await Promise.all(
    fallbackCandidates.map(async (message) => {
      const threadMessages = await readThreadMessagesForMatch(channelId, message, config);
      return {
        message,
        score: scoreFallbackThread(threadMessages, operation, config),
        threadMessages
      };
    })
  );

  return threadResults
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 1)
    .map((result) => ({
      channel: { id: channelId },
      text: result.message.text,
      threadMessages: result.threadMessages,
      ts: result.message.thread_ts ?? result.message.ts
    }));
}

function scoreFallbackThread(
  messages: SlackThreadMessage[],
  operation: OperationSession,
  config: SlackDiscussionConfig
) {
  void config;
  const text = normalizeMatchText(messages.map((message) => message.text ?? "").join(" "));
  const companyTokens = tokenizeMatchText(operation.companyName);
  const courseTokens = tokenizeMatchText(operation.courseName);
  const peopleTokens = [operation.om, operation.ld].flatMap(tokenizePersonName);
  let score = 0;

  if (companyTokens.some((token) => text.includes(token))) score += 10;
  if (courseTokens.some((token) => text.includes(token))) score += 4;
  score += peopleTokens.filter((token) => text.includes(token)).length * 2;
  score += messages.length > 1 ? 2 : 0;

  return score;
}

async function readThreadMessagesForMatch(channelId: string, message: SlackThreadMessage, config: SlackDiscussionConfig) {
  const threadTs = message.thread_ts ?? message.ts;

  if (!threadTs || !message.reply_count) {
    return [message];
  }

  const thread = await readSlackThread(channelId, threadTs, config);
  return thread.messages.length > 0 ? thread.messages : [message];
}

async function matchesOperationThread(
  messages: SlackThreadMessage[],
  operation: OperationSession,
  config: SlackDiscussionConfig
) {
  const text = normalizeMatchText(messages.map((message) => message.text ?? "").join(" "));

  if (!text) {
    return false;
  }

  const companyTokens = tokenizeMatchText(operation.companyName);
  const companyHit = companyTokens.some((token) => text.includes(token));

  if (!companyHit) {
    return false;
  }

  return hasOmAndLdParticipants(messages, operation, config);
}

async function hasOmAndLdParticipants(
  messages: SlackThreadMessage[],
  operation: OperationSession,
  config: SlackDiscussionConfig
) {
  const authorNames = await Promise.all(
    messages.map((message) => message.user ? readSlackUserNames(message.user, config) : Promise.resolve([]))
  );
  const mentionedNames = await Promise.all(
    messages.map((message) => readMentionedSlackUserNames(message.text ?? "", config))
  );
  const textNames = messages.map((message) => message.text ?? "");
  const authorOrMentionNames = [...authorNames.flat(), ...mentionedNames.flat(), ...textNames];

  return personMatches(operation.om, authorOrMentionNames) && personMatches(operation.ld, authorOrMentionNames);
}

async function readMentionedSlackUserNames(text: string, config: SlackDiscussionConfig) {
  const userIds = [...text.matchAll(/<@([UW][A-Z0-9]+)>/g)].map((match) => match[1]);
  const names = await Promise.all(userIds.map((userId) => readSlackUserNames(userId, config)));

  return names.flat();
}

async function readSlackUserNames(userId: string, config: SlackDiscussionConfig) {
  if (slackUserNameCache.has(userId)) {
    return slackUserNameCache.get(userId) ?? [];
  }

  const token = config.botToken || config.searchToken;

  try {
    const payload = await callSlackApi<SlackUserInfoResponse>("users.info", token, { user: userId });

    if (!payload.ok || !payload.user) {
      slackUserNameCache.set(userId, []);
      return [];
    }

    const names = [
      payload.user.profile?.display_name,
      payload.user.profile?.real_name,
      payload.user.real_name,
      payload.user.name
    ].filter((name): name is string => Boolean(name?.trim()));

    slackUserNameCache.set(userId, names);
    return names;
  } catch {
    slackUserNameCache.set(userId, []);
    return [];
  }
}

function personMatches(personName: string, candidates: string[]) {
  const personTokens = tokenizePersonName(personName);

  if (personTokens.length === 0) {
    return false;
  }

  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeMatchText(candidate);
    return personTokens.every((token) => normalizedCandidate.includes(token));
  });
}

function tokenizePersonName(value: string) {
  return cleanSlackText(value)
    .toLowerCase()
    .split(/[^0-9a-z가-힣]+/i)
    .map(normalizeMatchText)
    .filter(Boolean);
}

function tokenizeInstructorText(value: string) {
  return cleanSlackText(value)
    .replace(/강사님/g, " ")
    .replace(/강사/g, " ")
    .toLowerCase()
    .split(/[^0-9a-z가-힣]+/i)
    .map(normalizeMatchText)
    .filter((token) => token.length >= 2)
    .filter((token) => !isWeakMatchToken(token));
}

async function callSlackApi<TPayload>(
  method: string,
  token: string,
  params: Record<string, string>
): Promise<TPayload> {
  const searchParams = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== "")
  );
  const response = await fetch(`${SLACK_API_BASE_URL}/${method}?${searchParams}`, {
    headers: {
      authorization: `Bearer ${token}`
    }
  });

  return response.json() as Promise<TPayload>;
}

function dedupeSlackMatches(matches: SlackSearchMatch[]) {
  const unique = new Map<string, SlackSearchMatch>();

  for (const match of matches) {
    const channelId = match.channel?.id;
    const ts = match.ts;

    if (channelId && ts) {
      unique.set(`${channelId}-${ts}`, match);
    }
  }

  return [...unique.values()];
}

function buildSlackIssue(code: string, error?: string): SourceReadIssue {
  return {
    code,
    message: error ? `Slack API returned ${error}.` : "Slack API request failed.",
    recoverable: true
  };
}

function quoteSlackSearch(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return "";
  }

  return normalized.includes(" ") ? `"${normalized.replaceAll("\"", "")}"` : normalized;
}

function filterSlackMatchesByChannel(matches: SlackSearchMatch[], channels: string[]) {
  if (channels.length === 0) {
    return matches;
  }

  const allowedChannels = new Set(channels.map(normalizeSlackChannelValue));

  return matches.filter((match) => {
    const channelId = normalizeSlackChannelValue(match.channel?.id ?? "");
    const channelName = normalizeSlackChannelValue(match.channel?.name ?? "");
    return allowedChannels.has(channelId) || allowedChannels.has(channelName);
  });
}

function buildOperationDiscussionWindow(operation: OperationSession, config: SlackDiscussionConfig): SlackDiscussionWindow {
  const startDate = parseDateOnly(operation.startDate);
  const endDate = parseDateOnly(operation.endDate);

  if (startDate && endDate) {
    const oldestDate = addMonths(startDate, -config.windowMonthsBefore);
    const latestDate = addMonths(endDate, config.windowMonthsAfter);
    latestDate.setUTCDate(latestDate.getUTCDate() + 1);

    return {
      latest: dateToSlackTs(formatDateOnly(latestDate)),
      oldest: dateToSlackTs(formatDateOnly(oldestDate))
    };
  }

  return {
    latest: String(Math.floor(Date.now() / 1000)),
    oldest: dateToSlackTs(config.afterDate ?? formatSlackAfterDate(config.lookbackDays))
  };
}

function shouldAlwaysSurfaceSlackThread(operation: OperationSession) {
  const startDate = parseDateOnly(operation.startDate);
  const endDate = parseDateOnly(operation.endDate);

  if (!startDate || !endDate) {
    return false;
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const ninetyDaysFromNow = new Date(today);
  ninetyDaysFromNow.setUTCDate(ninetyDaysFromNow.getUTCDate() + 90);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

  return startDate.getTime() <= ninetyDaysFromNow.getTime() && endDate.getTime() >= thirtyDaysAgo.getTime();
}

function normalizeMatchText(value: string) {
  return cleanSlackText(value).toLowerCase().replace(/\s+/g, "");
}

function tokenizeMatchText(value: string) {
  return cleanSlackText(value)
    .toLowerCase()
    .split(/[^0-9a-z가-힣]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !isWeakMatchToken(token))
    .map(normalizeMatchText);
}

function isWeakMatchToken(token: string) {
  return new Set([
    "ai",
    "ax",
    "dx",
    "과정",
    "교육",
    "실습",
    "활용",
    "기초",
    "심화",
    "특강",
    "워크숍",
    "workshop"
  ]).has(token);
}

function formatSlackChannelFilter(channel: string) {
  return normalizeSlackChannelValue(channel);
}

function normalizeSlackChannelValue(value: string) {
  return value.trim().replace(/^#/, "").toLowerCase();
}

function isSlackChannelId(value: string) {
  return /^[CGD][A-Z0-9]+$/i.test(value.trim());
}

function formatSlackAfterDate(lookbackDays: number) {
  const date = new Date();
  date.setDate(date.getDate() - lookbackDays);
  return date.toISOString().slice(0, 10);
}

function dateToSlackTs(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return "0";
  }

  return String(Math.floor(date.getTime() / 1000));
}

function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMonths(value: Date, months: number) {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function slackTsToIso(ts: string) {
  const seconds = Number(ts.split(".")[0]);

  if (!Number.isFinite(seconds)) {
    return new Date().toISOString();
  }

  return new Date(seconds * 1000).toISOString();
}

function buildSlackAppUrl(channelId: string, ts: string) {
  return `slack://channel?team=&id=${encodeURIComponent(channelId)}&message=${encodeURIComponent(ts)}`;
}

function cleanSlackText(value: string) {
  return value
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value?.trim()) {
    return fallback;
  }

  return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
}

function normalizeOpenAiBaseUrl(value: string | undefined) {
  return (value?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
}

function parseCsv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTeamChannels(value: string | undefined) {
  const result = new Map<string, string[]>();

  for (const item of parseCsv(value)) {
    const [team, channels] = item.split(":");
    const teamKey = normalizeTeamKey(team ?? "");
    const channelIds = (channels ?? "")
      .split("|")
      .map((channel) => channel.trim())
      .filter(Boolean);

    if (teamKey && channelIds.length > 0) {
      result.set(teamKey, [...(result.get(teamKey) ?? []), ...channelIds]);
    }
  }

  return result;
}

function getConfiguredSlackChannels(config: SlackDiscussionConfig) {
  return [
    ...config.channels,
    ...config.companyOnlyChannels,
    ...config.reportChannels,
    ...[...config.teamChannels.values()].flat()
  ];
}

function normalizeTeamKey(value: string) {
  return value.trim().replace(/\s+/g, "");
}

function normalizeDateInput(value: string | undefined) {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
}
