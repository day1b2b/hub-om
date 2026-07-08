"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ImportUploadPanel() {
  const router = useRouter();
  const [headerRowNumber, setHeaderRowNumber] = useState(1);
  const [importYear, setImportYear] = useState(2026);
  const [isUploading, setIsUploading] = useState(false);
  const [isReadingSheet, setIsReadingSheet] = useState(false);
  const [isReadingNotion, setIsReadingNotion] = useState(false);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [notionMessage, setNotionMessage] = useState("");
  const [notionName, setNotionName] = useState("");
  const [notionTeam, setNotionTeam] = useState("team_1");
  const [notionUrl, setNotionUrl] = useState("");
  const [selectedSheetTab, setSelectedSheetTab] = useState("");
  const [sheetMessage, setSheetMessage] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [sheetReauthRequired, setSheetReauthRequired] = useState(false);
  const [sheetSourceTeam, setSheetSourceTeam] = useState<SourceTeamValue>("unknown");
  const [sheetTabs, setSheetTabs] = useState<GoogleSheetTab[]>([]);
  const [sheetUrl, setSheetUrl] = useState("");
  const isBusy = isUploading || isPending;
  const isNotionBusy = isReadingNotion || isPending;
  const isSheetBusy = isReadingSheet || isPending;
  const selectedTabContext = inferSheetTabContext(selectedSheetTab, importYear);

  async function uploadImport(formData: FormData) {
    setMessage("");
    setIsUploading(true);

    try {
      const response = await fetch("/api/admin/imports/upload", {
        body: formData,
        method: "POST"
      });
      const payload = (await response.json()) as {
        duplicateCount?: number;
        error?: string;
        importRunId?: string;
        ok?: boolean;
        storedCount?: number;
      };

      if (!response.ok || !payload.ok || !payload.importRunId) {
        setMessage(payload.error ?? "업로드를 저장하지 못했습니다.");
        return;
      }

      setMessage(`저장 ${payload.storedCount ?? 0}건 · 중복 ${payload.duplicateCount ?? 0}건`);
      startTransition(() => {
        router.push(`/admin/imports/${payload.importRunId}`);
        router.refresh();
      });
    } catch {
      setMessage("업로드 요청을 처리하지 못했습니다.");
    } finally {
      setIsUploading(false);
    }
  }

  async function loadSheetTabs() {
    setSheetMessage("");
    setSheetReauthRequired(false);
    setSheetTabs([]);
    setSelectedSheetTab("");
    setIsReadingSheet(true);

    try {
      const response = await fetch("/api/admin/imports/google-sheets/tabs", {
        body: JSON.stringify({ spreadsheetUrl: sheetUrl }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      const payload = (await response.json()) as {
        error?: string;
        ok?: boolean;
        reauthRequired?: boolean;
        selectedGid?: number | null;
        tabs?: GoogleSheetTab[];
      };

      if (!response.ok || !payload.ok || !payload.tabs) {
        setSheetMessage(payload.error ?? "탭을 불러오지 못했습니다.");
        setSheetReauthRequired(payload.reauthRequired === true);
        return;
      }

      const tabs = payload.tabs;
      const selectedTab = tabs.find((tab) => tab.gid === payload.selectedGid) ?? tabs[0];

      setSheetTabs(tabs);
      setSelectedSheetTab(selectedTab?.title ?? "");
      setSheetSourceTeam(inferSourceTeamFromText(selectedTab?.title ?? ""));
      setSheetMessage(`${tabs.length}개 탭을 찾았습니다. 가져올 탭을 선택해 주세요.`);
    } catch {
      setSheetMessage("스프레드시트 탭을 불러오지 못했습니다.");
    } finally {
      setIsReadingSheet(false);
    }
  }

  async function importSelectedSheet() {
    setSheetMessage("");
    setSheetReauthRequired(false);
    setIsReadingSheet(true);

    try {
      const response = await fetch("/api/admin/imports/google-sheets/import", {
        body: JSON.stringify({
          headerRowNumber,
          importYear,
          sourceName: sheetName,
          sourceTeam: sheetSourceTeam,
          spreadsheetUrl: sheetUrl,
          tabTitle: selectedSheetTab
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      const payload = (await response.json()) as {
        duplicateCount?: number;
        error?: string;
        errorCount?: number;
        headerRowNumber?: number;
        importRunId?: string;
        ok?: boolean;
        reauthRequired?: boolean;
        rowCount?: number;
        storedCount?: number;
      };

      if (!response.ok || !payload.ok || !payload.importRunId) {
        setSheetMessage(payload.error ?? "스프레드시트를 가져오지 못했습니다.");
        setSheetReauthRequired(payload.reauthRequired === true);
        return;
      }

      setSheetMessage(
        [
          `저장 ${payload.storedCount ?? 0}건`,
          `중복 ${payload.duplicateCount ?? 0}건`,
          `확인 필요 ${payload.errorCount ?? 0}건`,
          payload.headerRowNumber ? `헤더 ${payload.headerRowNumber}행` : ""
        ]
          .filter(Boolean)
          .join(" · ")
      );
      startTransition(() => {
        router.push(`/admin/imports/${payload.importRunId}`);
        router.refresh();
      });
    } catch {
      setSheetMessage("스프레드시트 가져오기 요청을 처리하지 못했습니다.");
    } finally {
      setIsReadingSheet(false);
    }
  }

  async function importNotionDatabase() {
    setNotionMessage("");
    setIsReadingNotion(true);

    try {
      const response = await fetch("/api/admin/imports/notion/import", {
        body: JSON.stringify({
          notionUrl,
          sourceName: notionName,
          sourceTeam: notionTeam
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      const payload = (await response.json()) as {
        duplicateCount?: number;
        error?: string;
        importRunId?: string;
        ok?: boolean;
        storedCount?: number;
      };

      if (!response.ok || !payload.ok || !payload.importRunId) {
        setNotionMessage(payload.error ?? "Notion 데이터를 가져오지 못했습니다.");
        return;
      }

      setNotionMessage(`가져옴 ${payload.storedCount ?? 0}건 · 중복 ${payload.duplicateCount ?? 0}건`);
      startTransition(() => {
        router.push(`/admin/imports/${payload.importRunId}`);
        router.refresh();
      });
    } catch {
      setNotionMessage("Notion 가져오기 요청을 처리하지 못했습니다.");
    } finally {
      setIsReadingNotion(false);
    }
  }

  return (
    <section className="import-entry-section" aria-label="데이터 가져오기">
      <div className="sheet-import-panel">
        <div className="sheet-import-heading">
          <div>
            <span>Notion</span>
            <strong>Notion 데이터베이스 가져오기</strong>
            <p>링크를 비우면 선택한 팀의 서버 설정 Notion DB를 검수 대기 데이터로 저장합니다. 운영 데이터 반영은 하지 않습니다.</p>
          </div>
          <button disabled={isNotionBusy} onClick={importNotionDatabase} type="button">
            {isNotionBusy ? "가져오는 중" : "Notion 가져오기"}
          </button>
        </div>

        <div className="sheet-import-grid">
          <label className="wide-field">
            Notion 데이터베이스 URL 또는 ID
            <input
              onChange={(event) => setNotionUrl(event.target.value)}
              placeholder="https://app.notion.com/p/..."
              value={notionUrl}
            />
          </label>
          <label>
            담당 팀
            <select onChange={(event) => setNotionTeam(event.target.value)} value={notionTeam}>
              <option value="team_1">기업교육 1팀</option>
              <option value="team_2">기업교육 2팀</option>
              <option value="unknown">직접 입력한 URL 사용</option>
            </select>
          </label>
          <label>
            가져온 곳 이름
            <input onChange={(event) => setNotionName(event.target.value)} placeholder="비워두면 Notion 데이터베이스" value={notionName} />
          </label>
        </div>

        {notionMessage ? <p className="import-message">{notionMessage}</p> : null}
      </div>

      <div className="sheet-import-panel">
        <div className="sheet-import-heading">
          <div>
            <span>추천</span>
            <strong>스프레드시트 구조 확인 후 가져오기</strong>
            <p>팀별로 비슷한 표를 같은 기준으로 읽고, 짧은 날짜는 기준 연도로 보정합니다.</p>
          </div>
          <button disabled={!sheetUrl.trim() || isSheetBusy} onClick={loadSheetTabs} type="button">
            {isSheetBusy && sheetTabs.length === 0 ? "확인 중" : "스프레드시트 확인하기"}
          </button>
        </div>

        <div className="sheet-import-grid">
          <label className="wide-field">
            스프레드시트 또는 탭 URL
            <input
              onChange={(event) => setSheetUrl(event.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={sheetUrl}
            />
          </label>
          <label>
            헤더 시작 행
            <input
              min={1}
              onChange={(event) => setHeaderRowNumber(Number(event.target.value) || 1)}
              type="number"
              value={headerRowNumber}
            />
          </label>
          <label>
            기준 연도
            <input
              min={2000}
              max={2100}
              onChange={(event) => setImportYear(Number(event.target.value) || 2026)}
              type="number"
              value={importYear}
            />
          </label>
          <label>
            담당 팀
            <select onChange={(event) => setSheetSourceTeam(event.target.value as SourceTeamValue)} value={sheetSourceTeam}>
              <option value="unknown">자동/미확인</option>
              <option value="team_1">기업교육 1팀</option>
              <option value="team_2">기업교육 2팀</option>
            </select>
          </label>
          <label>
            가져온 곳 이름
            <input onChange={(event) => setSheetName(event.target.value)} placeholder="비워두면 탭 이름 사용" value={sheetName} />
          </label>
        </div>

        {sheetTabs.length > 0 ? (
          <div className="sheet-tab-picker">
            <label>
              가져올 탭
              <select onChange={(event) => handleSheetTabChange(event.target.value)} value={selectedSheetTab}>
                {sheetTabs.map((tab) => (
                  <option key={tab.gid} value={tab.title}>
                    {tab.title}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={!selectedSheetTab || isSheetBusy} onClick={importSelectedSheet} type="button">
              {isSheetBusy && sheetTabs.length > 0 ? "가져오는 중" : "이 기준으로 가져오기"}
            </button>
          </div>
        ) : null}

        {selectedSheetTab ? (
          <div className="sheet-tab-context" aria-label="선택한 탭 해석">
            <span>{selectedTabContext.kind}</span>
            <span>{selectedTabContext.team}</span>
            <span>{selectedTabContext.dateRule}</span>
          </div>
        ) : null}

        {sheetMessage ? (
          <div className="import-message-row">
            <p className="import-message">{sheetMessage}</p>
            {sheetReauthRequired ? (
              <button onClick={goToGoogleReauth} type="button">
                Google 권한 다시 받기
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <details className="file-import-details">
        <summary>CSV/JSON 파일로 올리기</summary>
        <div className="file-import-note">
          <strong>스프레드시트 링크를 쓸 수 없을 때만 사용합니다.</strong>
          <span>CSV로 저장한 파일이나 Codex/Claude가 만든 JSON 파일을 올릴 수 있습니다.</span>
        </div>

        <form action={uploadImport} className="import-upload-panel">
          <label>
            담당 팀
            <select name="sourceTeam" defaultValue="unknown">
              <option value="unknown">모르겠음</option>
              <option value="team_1">기업교육 1팀</option>
              <option value="team_2">기업교육 2팀</option>
            </select>
          </label>
          <label>
            데이터 종류
            <select name="sourceType" defaultValue="spreadsheet">
              <option value="spreadsheet">스프레드시트</option>
              <option value="email">메일</option>
              <option value="slack">Slack</option>
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <label>
            가져온 곳 이름
            <input name="sourceName" placeholder="비워두면 파일명 사용" />
          </label>
          <label>
            기준 연도
            <input defaultValue={importYear} max={2100} min={2000} name="importYear" type="number" />
          </label>
          <label>
            업로드 파일
            <input accept=".csv,.json,.txt,text/csv,application/json" name="file" required type="file" />
          </label>
          <button disabled={isBusy} type="submit">
            {isBusy ? "올리는 중" : "파일 올리고 검토하기"}
          </button>
          {message ? <p>{message}</p> : null}
        </form>
      </details>
    </section>
  );

  function handleSheetTabChange(tabTitle: string) {
    setSelectedSheetTab(tabTitle);
    setSheetSourceTeam(inferSourceTeamFromText(tabTitle));
  }
}

interface GoogleSheetTab {
  gid: number;
  title: string;
}

type SourceTeamValue = "unknown" | "team_1" | "team_2";

function inferSheetTabContext(tabTitle: string, importYear: number) {
  const normalized = tabTitle.replace(/\s+/g, "").toLowerCase();

  return {
    dateRule: `${importYear}년 기준`,
    kind: normalized.includes("회고") || normalized.includes("종료")
      ? "종료/회고"
      : normalized.includes("배정")
        ? "OM 배정"
        : "일반 탭",
    team: sourceTeamLabel(inferSourceTeamFromText(tabTitle))
  };
}

function inferSourceTeamFromText(value: string): SourceTeamValue {
  const normalized = value.replace(/\s+/g, "").toLowerCase();

  if (normalized.includes("1팀") || normalized.includes("team1")) return "team_1";
  if (normalized.includes("2팀") || normalized.includes("team2")) return "team_2";
  return "unknown";
}

function sourceTeamLabel(value: SourceTeamValue) {
  if (value === "team_1") return "기업교육 1팀";
  if (value === "team_2") return "기업교육 2팀";
  return "팀 미확인";
}

function goToGoogleReauth() {
  const callbackUrl = `${window.location.pathname}${window.location.search}`;
  window.location.href = `/sign-in?reauth=google&callbackUrl=${encodeURIComponent(callbackUrl)}`;
}
