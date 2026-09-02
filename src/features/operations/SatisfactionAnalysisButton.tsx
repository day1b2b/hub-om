"use client";

import { useState } from "react";

const ANALYSIS_SITE_URL = "http://127.0.0.1:7890";

/**
 * 설치 창구 — 회사 구글 계정으로 열리고, 프로그램과 본인 설정 파일이 한 파일로 내려온다.
 * (Apps Script, 액세스: 조직 내 사용자)
 */
const INSTALL_URL =
  "https://script.google.com/a/macros/day1company.co.kr/s/AKfycbyXCmCLb9z7rN5NZ-T-Jpdm0bV6q42ZrtX1MNJt7vFnsjRPbC-G3ZCFPStjEs8bebb9/exec";

export function SatisfactionAnalysisButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button className="secondary-action add-round-trigger satisfaction-analysis-trigger" onClick={openDialog} type="button">
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
              <p>설치하셨으면 아래 &lsquo;분석 사이트 열기&rsquo;를 눌러주세요.</p>
              <p className="satisfaction-analysis-note">
                처음이시면 <b>설치하기</b>를 눌러주세요. 프로그램과 설정 파일이 한 파일로 받아집니다. 설치하면
                바탕화면에 <code>분석 사이트 열기</code> 아이콘이 생깁니다.
              </p>
            </div>

            <div className="lecture-note-footer">
              <div className="lecture-note-actions">
                <button onClick={closeDialog} type="button">
                  닫기
                </button>
                <a
                  className="satisfaction-analysis-install"
                  href={INSTALL_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  설치하기
                </a>
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
