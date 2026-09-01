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
            hub-om
          </p>
          <h1 id="home-title">기업교육 운영의 모든 것을 한 곳에서</h1>
          <p className="lede">
            과정 일정, 담당자, 운영 이슈, 관련 커뮤니케이션과 자료를 한 화면에서 확인하고
            관리하는 회사 내부 업무 도구입니다.
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

      <section className="public-home-section" aria-labelledby="google-data-title">
        <h2 id="google-data-title">Google 사용자 데이터 사용 안내</h2>
        <p>
          hub-om의 업무 기능은 @day1company.co.kr Google Workspace 계정으로 로그인한 회사
          구성원만 사용할 수 있습니다. Google 데이터는 로그인한 사용자가 승인한 OAuth 권한으로
          해당 사용자에게 제공되는 업무 기능을 수행하는 데만 사용됩니다.
        </p>
        <p>
          Gmail은 과정과 관련된 대화를 검색하고 제목, 날짜와 본문을 바탕으로 짧은 업무 요약을
          표시하는 데 읽기 전용으로 사용합니다. Google Sheets는 사용자가 지정한 업무용
          스프레드시트의 셀 값을 가져오는 데만 사용하며 원본 시트를 수정하지 않습니다.
        </p>
        <p>
          Google Calendar는 사용자의 요청에 따라 교육 일정을 생성, 수정 또는 삭제하는 데
          사용합니다. 대상은 사용자가 편집할 수 있는 본인 캘린더와 회사 공유 캘린더로 제한하며,
          캘린더의 공유 권한, ACL 또는 설정은 변경하지 않습니다.
        </p>
        <p>
          Google 사용자 데이터는 광고 목적으로 판매하거나 공유하지 않으며, 일반화된 AI 또는
          머신러닝 모델 학습에 사용하지 않습니다. 자세한 처리 기준은 개인정보처리방침에서 확인할
          수 있습니다.
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
