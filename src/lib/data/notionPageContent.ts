const NOTION_VERSION = "2022-06-28";
const MAX_BLOCKS = 2000;
const MAX_DEPTH = 6;

interface NotionRichText {
  plain_text?: string;
}

interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

interface NotionBlockChildrenResponse {
  has_more?: boolean;
  next_cursor?: string | null;
  results?: NotionBlock[];
}

export async function readNotionPageText(pageIdOrUrl: string, token: string): Promise<string> {
  const pageId = notionBlockIdFromValue(pageIdOrUrl);
  if (!pageId) {
    throw new Error("Notion 페이지 URL 또는 ID를 확인해 주세요.");
  }

  const lines: string[] = [];
  const budget = { remaining: MAX_BLOCKS };
  await appendBlockChildrenText(pageId, token, lines, 0, budget);
  return lines.join("\n").trim();
}

async function appendBlockChildrenText(
  blockId: string,
  token: string,
  lines: string[],
  depth: number,
  budget: { remaining: number }
): Promise<void> {
  if (depth > MAX_DEPTH || budget.remaining <= 0) return;

  const blocks = await listBlockChildren(blockId, token);
  for (const block of blocks) {
    if (budget.remaining <= 0) return;
    budget.remaining -= 1;

    const line = blockToLine(block);
    if (line) lines.push(line);

    if (block.has_children) {
      await appendBlockChildrenText(block.id, token, lines, depth + 1, budget);
    }
  }
}

async function listBlockChildren(blockId: string, token: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let startCursor: string | null = null;

  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`);
    url.searchParams.set("page_size", "100");
    if (startCursor) url.searchParams.set("start_cursor", startCursor);

    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION
      },
      cache: "no-store"
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error("Notion 통합 토큰 권한이 없습니다. 해당 페이지에 Notion 통합을 초대했는지 확인해 주세요.");
    }

    if (!response.ok) {
      throw new Error(`Notion 페이지를 읽지 못했습니다. ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as NotionBlockChildrenResponse;
    blocks.push(...(payload.results ?? []));
    startCursor = payload.has_more ? payload.next_cursor ?? null : null;
  } while (startCursor);

  return blocks;
}

function blockToLine(block: NotionBlock): string {
  const richText = (block[block.type] as { rich_text?: NotionRichText[] } | undefined)?.rich_text;
  const text = joinRichText(richText);
  if (!text) return "";

  switch (block.type) {
    case "heading_1":
      return `# ${text}`;
    case "heading_2":
      return `## ${text}`;
    case "heading_3":
      return `### ${text}`;
    case "bulleted_list_item":
    case "to_do":
      return `- ${text}`;
    case "numbered_list_item":
      return `1. ${text}`;
    case "quote":
      return `> ${text}`;
    default:
      return text;
  }
}

function joinRichText(richText: NotionRichText[] | undefined): string {
  return (richText ?? [])
    .map((item) => item.plain_text ?? "")
    .join("")
    .trim();
}

function notionBlockIdFromValue(value: string): string | null {
  const compactId = value.match(/[0-9a-f]{32}/i)?.[0];
  if (compactId) {
    return compactId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
  }

  const dashedId = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  return dashedId ?? null;
}
