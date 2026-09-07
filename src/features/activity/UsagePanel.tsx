"use client";
import { useEffect, useState } from "react";
import { ActivityPanel } from "@/app/admin/activity/ActivityPanel";
import styles from "@/app/admin/activity/activity.module.css";
type Metrics = { date: string; users: number; requests: number; errors: number; automatedRequests: number; changes: number; fetchedAt: string };
export function UsagePanel({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/activity/usage?${new URLSearchParams({ date })}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; })
      .then(body => { setData(body); setError(""); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [date, refresh]);
  const oldest = new Date(new Date(`${today}T00:00:00Z`).getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const cards = [["이용한 사람", data?.users], ["사용자 API 요청", data?.requests], ["사용자 요청 오류", data?.errors], ["사용자 데이터 변경", data?.changes], ["토큰·자동 요청", data?.automatedRequests]] as const;
  return <>
    <section className={`${styles.panel} ${styles.usage}`} aria-label="하루 이용 요약">
      <div className={styles.filters}><label>집계 날짜<input type="date" value={date} min={oldest} max={today} onChange={e => { setDate(e.target.value); setLoading(true); }} /></label><button onClick={() => { setDate(today); setLoading(true); setRefresh(v => v + 1); }}>오늘</button><button onClick={() => { setLoading(true); setRefresh(v => v + 1); }}>수치 새로고침</button></div>
      <p className={styles.note}>선택한 날짜의 한국 시간 00시부터 집계합니다. 사람 수는 사용자 API 요청의 이메일 기준이며, 화면 방문자 수와 다릅니다. 이 페이지와 변경 이력을 조회한 요청은 제외합니다. 아래 상세 검색은 요약 수치에 영향을 주지 않습니다.</p>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <div className={styles.metrics} aria-busy={loading}>{cards.map(([label, value]) => <article key={label} className={styles.metric}>{label}<strong>{loading || error || value === undefined ? "—" : value.toLocaleString("ko-KR")}</strong></article>)}</div>
      {!loading && !error && data ? <p className={styles.note}>{new Date(data.fetchedAt).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })} 기준 · 토큰 요청은 공용 인증키를 사용하는 외부 도구·자동 작업을 포함합니다.</p> : null}
    </section>
    <h2>요청 상세</h2><ActivityPanel key={date} mode="requests" defaultDate={date} />
  </>;
}
