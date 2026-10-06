export interface GoogleSheetTab {
  gid: number;
  title: string;
}

const SHEETS_API_BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";

export function parseGoogleSpreadsheetUrl(input: string) {
  const trimmedInput = input.trim();
  const idMatch = trimmedInput.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const spreadsheetId = idMatch?.[1] ?? "";

  if (!spreadsheetId) {
    throw new Error("Google 스프레드시트 URL을 확인해 주세요.");
  }

  let gid: number | null = null;

  try {
    const parsedUrl = new URL(trimmedInput);
    const gidValue = parsedUrl.searchParams.get("gid") ?? parsedUrl.hash.match(/gid=(\d+)/)?.[1] ?? null;
    gid = gidValue ? Number(gidValue) : null;
  } catch {
    gid = null;
  }

  return {
    gid: Number.isFinite(gid) ? gid : null,
    spreadsheetId
  };
}

export async function listGoogleSheetTabs(accessToken: string, spreadsheetId: string): Promise<GoogleSheetTab[]> {
  const url = `${SHEETS_API_BASE_URL}/${spreadsheetId}?fields=sheets(properties(sheetId,title,index))`;
  const payload = await fetchGoogleSheetsApi<{
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
      };
    }>;
  }>(accessToken, url);

  return (payload.sheets ?? [])
    .map((sheet) => sheet.properties)
    .filter((properties): properties is { sheetId: number; title: string } => {
      return typeof properties?.sheetId === "number" && typeof properties.title === "string";
    })
    .map((properties) => ({
      gid: properties.sheetId,
      title: properties.title
    }));
}

export async function readGoogleSheetRows(accessToken: string, spreadsheetId: string, tabTitle: string) {
  const range = encodeURIComponent(`${quoteSheetTitle(tabTitle)}!A1:ZZ2000`);
  const url = `${SHEETS_API_BASE_URL}/${spreadsheetId}/values/${range}?majorDimension=ROWS`;
  const payload = await fetchGoogleSheetsApi<{
    values?: string[][];
  }>(accessToken, url);

  return payload.values ?? [];
}

async function fetchGoogleSheetsApi<T>(accessToken: string, url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("스프레드시트를 읽을 권한이 없습니다. Google로 다시 로그인해 권한을 허용해 주세요.");
  }

  if (!response.ok) {
    throw new Error("Google 스프레드시트를 읽지 못했습니다.");
  }

  return response.json() as Promise<T>;
}

function quoteSheetTitle(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}
