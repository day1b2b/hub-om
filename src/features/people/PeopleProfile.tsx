import Link from "next/link";
import type { ReactNode } from "react";
import { PEOPLE_STATUS_LABEL, type PeopleStatus } from "@/lib/people/peopleStatus";
import { WikiAvatar } from "@/features/wiki/wikiAvatar";

// =============================================================================
// 강사 위키·코치 위키 공통 상세 틀
// 헤더(이름·상태·전문분야·지표 4칸) → 고정 알림 → 본문 2단(왼쪽 소개·투입 이력·운영 메모 / 오른쪽 가용성·조건·연락처·관리).
// 서버·클라이언트 컴포넌트 양쪽에서 쓸 수 있게 상태(hook)를 두지 않는다.
// =============================================================================

export function PeopleAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return <WikiAvatar name={name} size={size} />;
}

export function PeopleStatusPill({ status }: { status: PeopleStatus }) {
  return <span className={`people-status people-status--${status}`}>{PEOPLE_STATUS_LABEL[status]}</span>;
}

export interface PeopleKpi {
  label: string;
  value: ReactNode;
}

export function PeopleDetailHeader({
  backHref,
  backLabel,
  avatarName,
  title,
  badges,
  fields,
  kpis,
  actions
}: {
  backHref: string;
  backLabel: string;
  avatarName: string;
  /** 이름. 강사는 이름 수정 컴포넌트를 넘긴다. */
  title: ReactNode;
  badges: ReactNode;
  fields: string[];
  kpis: PeopleKpi[];
  actions?: ReactNode;
}) {
  return (
    <>
      <Link className="back-link" href={backHref}>← {backLabel}</Link>
      <header className="people-detail-head">
        <PeopleAvatar name={avatarName} size="lg" />
        <div className="people-detail-head-main">
          <div className="people-detail-title">
            {title}
            {badges}
            {actions ? <span className="people-detail-actions">{actions}</span> : null}
          </div>
          {fields.length > 0 ? (
            <div className="people-chips">
              {fields.map((field) => <span className="people-chip" key={field}>{field}</span>)}
            </div>
          ) : null}
          <dl className="people-kpis">
            {kpis.map((kpi) => (
              <div key={kpi.label}>
                <dt>{kpi.label}</dt>
                <dd>{kpi.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>
    </>
  );
}

/** 섭외 전에 꼭 봐야 하는 알림. 없으면 아무것도 그리지 않는다. */
export function PeoplePinned({ items }: { items: Array<{ key: string; text: ReactNode; tone: "bad" | "warn" }> }) {
  if (items.length === 0) return null;
  return (
    <ul className="people-pinned" aria-label="고정 알림">
      {items.map((item) => (
        <li className={`people-pinned-item people-pinned-item--${item.tone}`} key={item.key}>📌 {item.text}</li>
      ))}
    </ul>
  );
}

export function PeopleDetailBody({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="people-detail-body">
      <div className="people-detail-main">{main}</div>
      <aside className="people-detail-side">{side}</aside>
    </div>
  );
}

export function PeopleCard({
  title,
  note,
  actions,
  children,
  id
}: {
  title: string;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="people-card" id={id}>
      <div className="people-card-title">
        <h2>{title}</h2>
        {note ? <span className="people-card-note">{note}</span> : null}
        {actions ? <span className="people-card-actions">{actions}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** 라벨/값 목록. 값이 비면 "-"로 보여 준다. */
export function PeopleFacts({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="people-facts">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{isEmpty(item.value) ? <span className="td-muted">-</span> : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function isEmpty(value: ReactNode): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}
