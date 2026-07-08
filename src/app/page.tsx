import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = {
  title: "hub-om | 기업교육 운영 관리",
  description: "hub-om은 기업교육 운영 현황, 일정, 논의, 자료 후보를 관리하는 내부 업무 도구입니다."
};

export default function PublicHomePage() {
  return (
    <main className="public-home">
      <section className="public-hero" aria-labelledby="home-title">
        <div className="public-hero-copy">
          <Image alt="OM" className="public-home-logo" height={72} priority src="/hub-om-logo-120.png" width={72} />
          <p className="eyebrow">hub-om</p>
          <h1 id="home-title">기업교육 운영 현황을 한 곳에서 관리합니다.</h1>
          <p className="lede">
            hub-om은 운영 담당자가 과정 일정, 담당자, 운영 이슈, 관련 커뮤니케이션, 자료 후보를
            확인하고 교육 운영 상태를 관리하기 위한 내부 업무 도구입니다.
          </p>
          <div className="public-home-actions">
            <a className="primary-link" href="/sign-in?callbackUrl=/dashboard">
              회사 계정으로 로그인
            </a>
            <a className="secondary-link" href="/privacy">
              개인정보처리방침
            </a>
          </div>
        </div>
      </section>

      <section className="public-home-section" aria-labelledby="features-title">
        <h2 id="features-title">주요 기능</h2>
        <div className="public-home-grid">
          <article>
            <h3>운영 현황 확인</h3>
            <p>과정별 일정, 상태, 담당자, 준비 항목을 표준 운영 화면에서 확인합니다.</p>
          </article>
          <article>
            <h3>관련 논의 추적</h3>
            <p>과정과 관련된 메일 논의 후보를 읽기 전용으로 조회해 운영 맥락을 빠르게 찾습니다.</p>
          </article>
          <article>
            <h3>자료 후보 검토</h3>
            <p>Drive, Sheets, Calendar 연동이 설정된 경우 운영 자료와 일정 후보를 검토합니다.</p>
          </article>
        </div>
      </section>

      <section className="public-home-section" aria-labelledby="data-title">
        <h2 id="data-title">Google 사용자 데이터 사용 목적</h2>
        <p>
          hub-om은 허용된 회사 Google Workspace 계정인지 확인하고, 사용자가 승인한 범위에서 운영
          업무에 필요한 Google 데이터를 읽기 전용으로 조회합니다. Gmail 데이터는 과정 관련 논의
          후보를 찾기 위한 제목, 발신자, 날짜, 스니펫, 메타데이터 중심으로 사용되며 메일 본문 전체를
          저장하지 않습니다.
        </p>
        <p>
          Google Drive, Sheets, Calendar 데이터는 운영 자료와 일정 후보 확인 목적으로만 사용됩니다.
          hub-om은 Google 사용자 데이터를 광고 목적으로 판매하거나 일반화된 AI 또는 머신러닝 모델
          학습에 사용하지 않습니다.
        </p>
      </section>

      <footer className="public-home-footer">
        <a href="/privacy">개인정보처리방침</a>
        <a href="/terms">서비스 약관</a>
        <a href="mailto:d1.b2b.ax.3@gmail.com">문의</a>
      </footer>
    </main>
  );
}
