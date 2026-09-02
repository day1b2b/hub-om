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
          구성원만 사용할 수 있습니다. 회사 계정 로그인은 사용자 식별과 앱 접근 확인에 사용하며,
          Google 업무 데이터를 읽거나 일정을 변경할 때 사용하는 계정은 연동 기능에 따라 다릅니다.
        </p>
        <p>
          만족도 매칭은 기본적으로 비활성화되어 있습니다. 운영자가 활성화한 경우 B2B 공용 Google
          계정의 권한으로 업무용 Google Sheets를 읽습니다. 조회한 값을 검토하고 반영하면
          hub-om 데이터베이스에 저장하며, 원본 시트는 수정하거나 삭제하지 않습니다.
          별도의 사용자 OAuth 기반 시트 가져오기는 해당 사용자가
          승인한 읽기 권한을 사용합니다.
        </p>
        <p>
          Google Calendar 연동은 B2B 공용 계정의 권한으로 설정된 파트별 캘린더에 교육 일정을
          생성하고 담당자와 현장 운영 담당자를 초대합니다. hub-om에서 해당 운영 정보를 수정하거나
          삭제하면 연결된 일정에도 반영합니다. 직원 개인의 Calendar OAuth 권한으로 개인 캘린더를
          직접 수정하는 방식은 아닙니다.
        </p>
        <p>
          별도로 설정된 업무 시트와 캘린더 조회에는 서비스 계정에 부여된 접근 권한을 사용할 수
          있습니다. hub-om은 캘린더의 공유 권한, ACL 또는 설정을 변경하지 않으며, Gmail API로
          직원의 메일함을 검색하거나 메일 본문을 읽지 않습니다.
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
