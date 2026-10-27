import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { diagnoseCoachPortal, type CoachPortalDiagnosis } from "@/lib/data/coachPortalDiagnosis";

export const dynamic = "force-dynamic";

// 코치 본인 포털 진단(읽기 전용). /api/coach/* 가 500일 때 Mongo shadow의 어느 단계가 막혔는지 보여준다.
// collection·인덱스 조회와 저장소 열기만 하며 아무것도 만들거나 저장하지 않는다.
export default async function CoachPortalDiagnosisPage() {
  await requireAdminSession();
  let diagnosis: CoachPortalDiagnosis | null = null;
  let error: string | null = null;
  try {
    diagnosis = await diagnoseCoachPortal();
  } catch {
    error = "진단 중 예상하지 못한 오류가 났습니다.";
  }

  return (
    <main className="dashboard-shell">
      <AppSidebar label="데이터 관리" teamScope="both" />

      <section className="content">
        <Link className="back-link" href="/coaches/admin">← 코치 관리로</Link>

        <div className="detail-section">
          <div className="section-title">
            <h2>코치 포털 진단</h2>
            <span>조회만 (저장·생성 안 함)</span>
          </div>
          <div className="iw-bucket-body">
            <p className="field-hint">
              코치 개인 링크(/coach)의 정보 조회·일정 저장이 실패할 때, 저장소 연결의 어느 단계에서 막히는지 확인합니다.
            </p>
          </div>
        </div>

        {error ? (
          <div className="detail-section">
            <div className="section-title"><h2>진단 실패</h2></div>
            <div className="iw-bucket-body"><p className="field-hint">{error}</p></div>
          </div>
        ) : diagnosis ? (
          <>
            <div className="detail-grid">
              {diagnosis.selectors.map(selector => (
                <div className="detail-panel" key={selector.name}><span>{selector.name}</span><strong>{selector.value}</strong></div>
              ))}
            </div>

            <div className="detail-section">
              <div className="section-title"><h2>단계별 확인</h2><span>위에서부터 순서대로</span></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>단계</th><th>결과</th><th>코드</th></tr></thead>
                  <tbody>
                    {diagnosis.steps.map(step => (
                      <tr key={step.label}>
                        <td>{step.label}</td>
                        <td><span className={`status ${step.ok ? "done" : "muted"}`}>{step.ok ? "통과" : "실패"}</span></td>
                        <td>{step.code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {diagnosis.collections.length > 0 ? (
              <div className="detail-section">
                <div className="section-title"><h2>포털이 쓰는 collection</h2><span>있음·문서 수·준비 상태(검증 규칙·인덱스)</span></div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>모델</th><th>있음</th><th>문서 수</th><th>준비</th><th>코드</th></tr></thead>
                    <tbody>
                      {diagnosis.collections.map(row => (
                        <tr key={row.model}>
                          <td>{row.model}</td>
                          <td>{row.exists ? "있음" : "없음"}</td>
                          <td>{row.documents ?? "-"}</td>
                          <td><span className={`status ${row.ok ? "done" : "muted"}`}>{row.ok ? "준비됨" : "안 됨"}</span></td>
                          <td>{row.code}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
