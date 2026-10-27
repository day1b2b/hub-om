import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { runCoachPublicRequest } from "@/lib/data/coachPublicComposition";
import { runInstructorContractMatchPreview, type MatchPreview } from "@/lib/instructors/instructorContractMatchRun";

export const dynamic = "force-dynamic";

// 강사 매칭 미리보기(dry-run). 운영현황·계약시트·노션 노트를 읽어 자동 연결 가능 수를 보여준다.
// 강사위키 페이지와 같은 서버 컴포넌트 + runCoachPublicRequest 패턴(운영현황·강사노트 저장소를 함께 등록).
// 조회만 하며 아무것도 저장하지 않는다.
export default async function InstructorMatchPage() {
  await requireAdminSession();
  return runCoachPublicRequest(renderInstructorMatchPage);
}

async function renderInstructorMatchPage() {
  let preview: MatchPreview | null = null;
  let error: string | null = null;
  try {
    preview = await runInstructorContractMatchPreview();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  return (
    <main className="dashboard-shell">
      <AppSidebar label="데이터 관리" teamScope="both" />

      <section className="content">
        <Link className="back-link" href="/instructor-wiki">← 강사위키 목록으로</Link>

        <div className="detail-section">
          <div className="section-title">
            <h2>강사 매칭 미리보기</h2>
            <span>계약시트 기준 · 조회만 (저장 안 함)</span>
          </div>
          <div className="iw-bucket-body">
            <p className="field-hint">
              운영현황의 강사 표기를 강사 계약시트(코스ID)를 다리로 노션 강사에 연결했을 때, 몇 명이 자동 연결되는지 미리 봅니다.
              실제 연결은 아직 하지 않습니다.
            </p>
          </div>
        </div>

        {error ? (
          <div className="detail-section">
            <div className="section-title"><h2>읽기 실패</h2></div>
            <div className="iw-bucket-body">
              <p className="field-hint">{error}</p>
              <p className="field-hint">계약시트 env(INSTRUCTOR_CONTRACT_SHEET_ID)와 공유 권한을 확인해 주세요.</p>
            </div>
          </div>
        ) : preview ? (
          <>
            <div className="detail-grid">
              <div className="detail-panel"><span>자동 연결 가능</span><strong>{preview.autoLinkable}</strong></div>
              <div className="detail-panel"><span>모호(보류)</span><strong>{preview.ambiguous}</strong></div>
              <div className="detail-panel"><span>이미 연결됨</span><strong>{preview.alreadyLinked}</strong></div>
              <div className="detail-panel"><span>운영현황 강사 표기</span><strong>{preview.operationTokens}</strong></div>
              <div className="detail-panel"><span>계약 레코드</span><strong>{preview.contractRecords}</strong></div>
              <div className="detail-panel"><span>노션 강사</span><strong>{preview.notionInstructors}</strong></div>
            </div>

            <div className="detail-section">
              <div className="section-title"><h2>자동 연결 예정 (샘플)</h2><span>최대 50건</span></div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>운영현황 표기</th><th>노션 강사</th><th>근거</th></tr>
                  </thead>
                  <tbody>
                    {preview.sampleAutoLinks.length > 0 ? (
                      preview.sampleAutoLinks.map((link, index) => (
                        <tr key={`${link.operationName}-${index}`}>
                          <td>{link.operationName}</td>
                          <td><strong className="title-company">{link.notionName}</strong></td>
                          <td><span className={`status ${link.via === "email" ? "done" : "muted"}`}>{link.via === "email" ? "이메일" : "이름"}</span></td>
                        </tr>
                      ))
                    ) : (
                      <tr><td className="empty-state" colSpan={3}><strong>자동 연결 예정이 없습니다.</strong></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="detail-section">
              <div className="section-title"><h2>모호 — 수동 확인 필요 (샘플)</h2><span>최대 50건</span></div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>운영현황 표기</th><th>사유</th></tr>
                  </thead>
                  <tbody>
                    {preview.sampleAmbiguous.length > 0 ? (
                      preview.sampleAmbiguous.map((item, index) => (
                        <tr key={`${item.operationName}-${index}`}>
                          <td>{item.operationName}</td>
                          <td>{item.reason}</td>
                        </tr>
                      ))
                    ) : (
                      <tr><td className="empty-state" colSpan={2}><strong>모호 건이 없습니다.</strong></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
