"use client";

import { useState } from "react";

const ANALYSIS_SITE_URL = "http://127.0.0.1:7890";

export function SatisfactionAnalysisButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button className="secondary-action add-round-trigger" onClick={openDialog} type="button">
        만족도 분석
      </button>

      {isOpen ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={closeDialog} />
          <section
            aria-labelledby="satisfaction-analysis-title"
            className="drive-review-dialog satisfaction-analysis-dialog"
          >
            <div className="drive-review-header">
              <div>
                <h2 id="satisfaction-analysis-title">만족도 분석</h2>
                <p>내 PC에서 실행 중인 만족도 분석 사이트를 새 탭에서 엽니다.</p>
              </div>
              <button aria-label="만족도 분석 닫기" onClick={closeDialog} type="button">
                닫기
              </button>
            </div>

            <div className="lecture-note-body satisfaction-analysis-guide">
              <p>분석 사이트를 실행한 뒤 열어주세요.</p>
              <ol>
                <li>
                  <code>survey_analysis</code> 스킬 폴더 &gt; <code>런처</code> &gt;{" "}
                  <code>start-분석사이트</code> 실행
                </li>
                <li>아래 &lsquo;분석 사이트 열기&rsquo; 클릭</li>
              </ol>
              <p className="satisfaction-analysis-note">
                스킬 설치 안내는 <code>survey_analysis</code> 스킬의 <code>설치안내.md</code>에 있습니다.
              </p>
            </div>

            <div className="lecture-note-footer">
              <div className="lecture-note-actions">
                <button onClick={closeDialog} type="button">
                  닫기
                </button>
                <a
                  className="satisfaction-analysis-open"
                  href={ANALYSIS_SITE_URL}
                  onClick={closeDialog}
                  rel="noreferrer"
                  target="_blank"
                >
                  분석 사이트 열기
                </a>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );

  function openDialog() {
    setIsOpen(true);
  }

  function closeDialog() {
    setIsOpen(false);
  }
}
