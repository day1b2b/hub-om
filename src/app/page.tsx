import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "hub-om | 기업교육 운영 관리",
  description: "hub-om은 기업교육 운영 현황, 일정, 논의, 자료 후보를 관리하는 내부 업무 도구입니다."
};

export default function PublicHomePage() {
  return (
    <main className="public-home">
      <section className="public-hero" aria-labelledby="home-title">
        <div className="public-hero-copy">
          <p className="eyebrow">
            <span aria-hidden="true" className="eyebrow-dot" />
            hub-om · LIVE STATUS
          </p>
          <h1 id="home-title">기업교육 운영 현황을 한 곳에서 관리합니다.</h1>
          <p className="lede">
            과정 일정, 담당자, 운영 이슈, 관련 커뮤니케이션, 자료 후보를 하나의 화면에서 확인하고
            교육 운영 상태를 관리하는 내부 업무 도구입니다.
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

        <aside aria-label="hub-om 핵심 가치" className="public-hero-panel">
          <p className="public-hero-panel-head">CORE_VALUES</p>
          <ol className="public-hero-panel-list">
            <li>
              <span className="public-hero-panel-idx">01</span>
              <span className="public-hero-panel-value">Customer-Centric</span>
            </li>
            <li>
              <span className="public-hero-panel-idx">02</span>
              <span className="public-hero-panel-value">Global Optimization</span>
            </li>
            <li>
              <span className="public-hero-panel-idx">03</span>
              <span className="public-hero-panel-value">Growth of Our People</span>
            </li>
          </ol>
        </aside>
      </section>

      <footer className="public-home-footer">
        <a href="/privacy">개인정보처리방침</a>
        <a href="/terms">서비스 약관</a>
        <a href="mailto:d1.b2b.ax.3@gmail.com">문의</a>
      </footer>
    </main>
  );
}
