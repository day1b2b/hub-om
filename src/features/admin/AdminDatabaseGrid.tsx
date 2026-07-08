"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DatabaseCellPreview, DatabaseTableSnapshot } from "@/lib/admin/databaseDashboard";
import type { TeamScope } from "@/lib/teamScope";

type SaveState = "editing" | "failed" | "idle" | "saving" | "saved";
type OperationSessionColumnView = "all" | "links" | "main" | "money" | "notes";

const OPERATION_SESSION_COLUMN_VIEWS: Record<OperationSessionColumnView, { columns: string[]; label: string }> = {
  main: {
    columns: ["기업", "상태", "아카이브", "시작일", "종료일", "OM", "LD", "교육형태", "강사", "지역"],
    label: "주요"
  },
  notes: {
    columns: ["기업", "상태", "차수", "교육일", "시간", "특이사항", "운영이슈", "OM 업데이트"],
    label: "메모"
  },
  money: {
    columns: ["기업", "비용 원문", "총비용", "강사비", "운영비", "전체 만족도", "강사 만족도", "결과보고"],
    label: "비용/만족도"
  },
  links: {
    columns: ["기업", "Drive", "싱크업", "결과보고서", "강의관리", "패들렛", "기업 Wiki", "강사 Wiki"],
    label: "링크"
  },
  all: {
    columns: [],
    label: "전체"
  }
};

interface AdminDatabaseGridProps {
  columns: string[];
  selectedTable: DatabaseTableSnapshot;
  tables: DatabaseTableSnapshot[];
  teamScope: TeamScope;
}

interface EditingCell {
  cell: DatabaseCellPreview;
  rowId: string;
  rowTitle: string;
}

export function AdminDatabaseGrid({ columns, selectedTable, tables, teamScope }: AdminDatabaseGridProps) {
  const router = useRouter();
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [operationSessionColumnView, setOperationSessionColumnView] = useState<OperationSessionColumnView>("main");
  const [isPending, startTransition] = useTransition();
  const displayedColumns = useMemo(() => {
    if (selectedTable.key !== "operation_sessions") return columns;
    if (operationSessionColumnView === "all") return columns;

    const selectedColumns = OPERATION_SESSION_COLUMN_VIEWS[operationSessionColumnView].columns;
    return selectedColumns.filter((column) => columns.includes(column));
  }, [columns, operationSessionColumnView, selectedTable.key]);
  const editableCount = useMemo(
    () => selectedTable.rows.reduce((sum, row) => sum + row.cells.filter((cell) => cell.editable && displayedColumns.includes(cell.label)).length, 0),
    [displayedColumns, selectedTable]
  );

  return (
    <div className="admin-database-workbench">
      <aside className="admin-database-browser" aria-label="관리 데이터 목록">
        <div className="admin-database-browser-header">
          <strong>데이터 목록</strong>
          <span>관리자 조회/수정</span>
        </div>
        <nav>
          {tables.map((table) => (
            <Link
              className={table.key === selectedTable.key ? "active" : ""}
              href={adminTableHref(table.key, teamScope)}
              key={table.key}
            >
              <span>{table.tableName}</span>
              <strong>{table.rowCount.toLocaleString("ko-KR")}</strong>
            </Link>
          ))}
        </nav>
      </aside>

      <section className="table-section admin-database-section" id={selectedTable.key}>
        <div className="table-header admin-database-grid-header">
          <div>
            <strong>{selectedTable.title}</strong>
            <span>
              {selectedTable.tableName} · {selectedTable.rowCount.toLocaleString("ko-KR")}행 · 최근 {formatOptionalDateTime(selectedTable.latestActivity)}
            </span>
          </div>
          <span>{selectedTable.description}</span>
        </div>

        {selectedTable.notes ? <p className="admin-database-note">{selectedTable.notes}</p> : null}

        <div className="admin-database-toolbar">
          <div>
            <strong>{selectedTable.tableName}</strong>
            <span>최근 {selectedTable.rows.length.toLocaleString("ko-KR")}행 표시</span>
            <span>{editableCount.toLocaleString("ko-KR")}개 셀 수정 가능</span>
          </div>
          {selectedTable.key === "operation_sessions" ? (
            <div className="admin-column-view-tabs" role="group" aria-label="운영 차수 열 보기">
              {(Object.keys(OPERATION_SESSION_COLUMN_VIEWS) as OperationSessionColumnView[]).map((view) => (
                <button
                  className={operationSessionColumnView === view ? "selected" : ""}
                  key={view}
                  onClick={() => setOperationSessionColumnView(view)}
                  type="button"
                >
                  {OPERATION_SESSION_COLUMN_VIEWS[view].label}
                </button>
              ))}
            </div>
          ) : null}
          <span>{displayedColumns.length + 2}개 열</span>
        </div>

        <div className="table-wrap admin-database-table-wrap">
          {selectedTable.rows.length > 0 ? (
            <table className="admin-database-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>식별자</th>
                  {displayedColumns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedTable.rows.map((row, index) => (
                  <tr key={row.id}>
                    <td>{index + 1}</td>
                    <td className="readonly admin-database-id-cell" title={row.id}>{formatIdentifier(row.id)}</td>
                    {displayedColumns.map((column) => (
                      <Cell
                        cell={row.cells.find((item) => item.label === column)}
                        isEditing={editingCell?.rowId === row.id && editingCell.cell.label === column}
                        key={`${row.id}-${column}`}
                        onOpen={(cell) => openCell(row.id, row.title, cell)}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              <strong>표시할 행이 없습니다.</strong>
              <span>목록은 준비되어 있지만 아직 저장된 데이터가 없습니다.</span>
            </div>
          )}
        </div>
      </section>

      {editingCell ? (
        <div className="admin-edit-backdrop" role="presentation">
          <form className="admin-edit-dialog" onSubmit={saveCell}>
            <div className="admin-edit-dialog-header">
              <div>
                <strong>{editingCell.cell.label}</strong>
                <span>{selectedTable.tableName} · {editingCell.rowTitle} · {formatIdentifier(editingCell.rowId)}</span>
              </div>
              <button onClick={closeEditor} type="button">닫기</button>
            </div>
            <div className="admin-edit-current-value">
              <span>현재 값</span>
              <pre>{editingCell.cell.value || "비어 있음"}</pre>
            </div>
            {editingCell.cell.editable ? (
              <label>
                <span>새 값</span>
                <EditorInput cell={editingCell.cell} onChange={setDraftValue} value={draftValue} />
              </label>
            ) : null}
            <div className="admin-edit-dialog-footer">
              <span className={saveState === "failed" ? "failed" : ""}>
                {message || (editingCell.cell.editable ? "저장하면 실제 DB에 반영됩니다." : "이 셀은 읽기 전용입니다.")}
              </span>
              {editingCell.cell.editable ? (
                <button disabled={saveState === "saving" || isPending} type="submit">
                  {saveState === "saving" || isPending ? "저장 중" : "DB 저장"}
                </button>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );

  function openCell(rowId: string, rowTitle: string, cell: DatabaseCellPreview) {
    setEditingCell({ cell, rowId, rowTitle });
    setDraftValue(cell.rawValue ?? cell.value);
    setSaveState("editing");
    setMessage("");
  }

  function closeEditor() {
    setEditingCell(null);
    setSaveState("idle");
    setMessage("");
  }

  async function saveCell(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingCell?.cell.field) return;

    setSaveState("saving");
    setMessage("");

    const response = await fetch("/api/admin/database/cell", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        field: editingCell.cell.field,
        rowId: editingCell.rowId,
        table: selectedTable.key,
        value: draftValue
      })
    }).catch(() => null);
    const payload = response ? ((await response.json().catch(() => ({}))) as { ok?: boolean; error?: string }) : {};

    if (!response?.ok || !payload.ok) {
      setSaveState("failed");
      setMessage(payload.error ?? "저장하지 못했습니다.");
      return;
    }

    setSaveState("saved");
    setMessage("DB에 저장됨");
    startTransition(() => router.refresh());
    window.setTimeout(closeEditor, 450);
  }
}

function Cell({
  cell,
  isEditing,
  onOpen
}: {
  cell?: DatabaseCellPreview;
  isEditing: boolean;
  onOpen: (cell: DatabaseCellPreview) => void;
}) {
  if (!cell) return <td className="admin-database-null" title="읽기 전용">비어 있음</td>;

  const isStatusLike = ["상태", "아카이브", "활성", "삭제", "오류", "검증"].includes(cell.label);
  const cellClassName = [
    "admin-database-value",
    cell.tone ?? "",
    cell.editable ? "editable" : "readonly"
  ].filter(Boolean).join(" ");

  return (
    <td
      className={cellClassName}
      onClick={() => onOpen(cell)}
      title={`${cell.label}: ${cell.value}${cell.editable ? "" : " (읽기 전용)"}`}
    >
      <span className={isEditing ? "admin-database-cell-shell editing" : "admin-database-cell-shell"}>
        <span className={isStatusLike ? "admin-database-chip" : "admin-database-cell-text"}>
          {isStatusLike ? cell.value || "-" : displayCellValue(cell.value)}
        </span>
        {cell.editable ? (
          <button aria-label={`${cell.label} 상세 보기 및 수정`} onClick={(event) => {
            event.stopPropagation();
            onOpen(cell);
          }} type="button">보기</button>
        ) : null}
      </span>
    </td>
  );
}

function EditorInput({
  cell,
  onChange,
  value
}: {
  cell: DatabaseCellPreview;
  onChange: (value: string) => void;
  value: string;
}) {
  if (cell.input === "textarea") {
    return <textarea autoFocus onChange={(event) => onChange(event.target.value)} rows={7} value={value} />;
  }

  if (cell.input === "enum" && cell.options) {
    return (
      <select autoFocus onChange={(event) => onChange(event.target.value)} value={value}>
        {cell.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  }

  if (cell.input === "boolean") {
    return (
      <select autoFocus onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="true">활성</option>
        <option value="false">비활성</option>
      </select>
    );
  }

  return (
    <input
      autoFocus
      onChange={(event) => onChange(event.target.value)}
      type={cell.input === "date" ? "date" : cell.input === "integer" || cell.input === "money" ? "number" : "text"}
      value={value}
    />
  );
}

function adminTableHref(tableKey: string, teamScope: TeamScope) {
  const params = new URLSearchParams({ table: tableKey });
  if (teamScope !== "both") params.set("team", teamScope);

  return `/admin/database?${params.toString()}`;
}

function displayCellValue(value: string) {
  if (!value) return "-";
  if (value.length <= 80) return value;

  return `${value.slice(0, 77)}...`;
}

function formatIdentifier(value: string) {
  if (value.length <= 18) return value;

  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatOptionalDateTime(value: string) {
  return value ? formatDateTime(value) : "기록 없음";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(new Date(value));
}
