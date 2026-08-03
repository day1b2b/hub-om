import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "서비스 약관 | hub-om",
  description: "hub-om 서비스 약관"
};

export default function TermsPage() {
  return (
    <main className="legal-shell">
      <article className="legal-document">
        <header className="legal-header">
          <Link className="legal-brand" href="/">
            hub-om
          </Link>
          <p className="eyebrow">Terms of Service</p>
          <h1>서비스 약관</h1>
          <p className="lede">
            본 약관은 hub-om 운영 관리 도구의 이용 조건과 사용자 책임을 정합니다. hub-om은
            기업교육 운영 현황, 일정, 논의, 자료 후보를 확인하고 관리하기 위한 내부 업무용
            서비스입니다.
          </p>
          <p className="legal-updated">시행일: 2026-06-16</p>
        </header>

        <section>
          <h2>1. 서비스 목적</h2>
          <p>
            hub-om은 기업교육 운영 담당자가 과정 운영 상태, 담당자, 일정, 운영 이슈, 관련
            커뮤니케이션, 자료 후보를 한 곳에서 확인하고 관리하도록 돕는 업무 도구입니다.
          </p>
        </section>

        <section>
          <h2>2. 이용 대상 및 계정</h2>
          <p>
            hub-om은 허용된 회사 Google Workspace 계정을 가진 사용자에게 제공됩니다. 사용자는 본인
            계정으로만 로그인해야 하며, 계정 접근 권한을 타인에게 공유하거나 양도해서는 안 됩니다.
          </p>
          <p>
            운영자는 보안, 조직 변경, 권한 변경, 서비스 안정성 확보를 위해 계정 접근을 제한하거나
            해제할 수 있습니다.
          </p>
        </section>

        <section>
          <h2>3. Google API 및 외부 원천 이용</h2>
          <p>
            hub-om은 사용자가 승인한 Google API 권한과 조직에서 설정한 읽기 전용 연동을 통해 운영
            업무에 필요한 후보 데이터를 조회할 수 있습니다. Gmail, Google Drive, Google Sheets,
            Google Calendar 등 외부 원천 데이터는 운영 판단을 돕기 위한 참고 정보로 제공됩니다.
          </p>
          <p>
            hub-om은 기본적으로 외부 원천에 쓰기 작업을 수행하지 않으며, 원천 데이터의 정확성,
            최신성, 완전성을 보장하지 않습니다. 사용자는 중요한 운영 판단 전 원천 시스템 또는
            담당자 확인을 함께 수행해야 합니다.
          </p>
        </section>

        <section>
          <h2>4. 사용자 의무</h2>
          <ul>
            <li>업무 목적 범위에서만 서비스를 이용해야 합니다.</li>
            <li>실제 고객사, 담당자, 강사, 비용, 매출, 원천 링크 등 민감한 업무 정보를 불필요하게 공유하지 않아야 합니다.</li>
            <li>서비스의 보안, 인증, 접근 제어를 우회하거나 방해해서는 안 됩니다.</li>
            <li>다른 사용자 또는 조직의 정보에 무단 접근해서는 안 됩니다.</li>
            <li>잘못된 데이터나 권한 문제를 발견하면 운영자에게 알려야 합니다.</li>
          </ul>
        </section>

        <section>
          <h2>5. 금지 행위</h2>
          <ul>
            <li>허가 없이 운영 데이터, 원천 데이터, 인증 정보, API 비밀값을 외부에 공개하는 행위</li>
            <li>서비스를 이용해 법령, 회사 정책, 제3자 권리를 침해하는 행위</li>
            <li>자동화 도구로 과도한 요청을 보내거나 서비스 안정성을 저해하는 행위</li>
            <li>접근 권한이 없는 데이터를 열람, 복사, 수정, 삭제하려는 행위</li>
            <li>hub-om의 기능 또는 데이터를 광고, 판매, 비업무 목적 분석에 사용하는 행위</li>
          </ul>
        </section>

        <section>
          <h2>6. 데이터 정확성과 책임 제한</h2>
          <p>
            hub-om은 여러 업무 원천에서 읽은 정보를 표준 운영 화면으로 정리하지만, 원천 시스템의
            상태, 권한, API 제한, 입력 오류에 따라 일부 정보가 누락되거나 지연될 수 있습니다.
          </p>
          <p>
            법령상 허용되는 범위에서 운영자는 서비스 이용 또는 이용 불가로 발생한 간접 손해,
            특별 손해, 결과적 손해에 대해 책임을 부담하지 않습니다.
          </p>
        </section>

        <section>
          <h2>7. 서비스 변경 및 중단</h2>
          <p>
            운영자는 기능 개선, 보안 조치, 장애 대응, 외부 API 변경, 배포 작업을 위해 서비스를
            변경하거나 일시 중단할 수 있습니다. 중요한 변경이 있는 경우 가능한 범위에서 사전에
            안내합니다.
          </p>
        </section>

        <section>
          <h2>8. 개인정보 및 Google 데이터</h2>
          <p>
            개인정보 및 Google 사용자 데이터 처리 기준은 개인정보처리방침에서 정합니다. 사용자는
            서비스를 이용함으로써 개인정보처리방침에 따른 데이터 처리를 이해하고 동의합니다.
          </p>
          {/* 개인정보처리방침 링크 숨김 처리 */}
          {/* <p>
            <a href="/privacy">개인정보처리방침 보기</a>
          </p> */}
        </section>

        <section>
          <h2>9. 약관 변경</h2>
          <p>
            운영자는 서비스 또는 법령 변경에 따라 본 약관을 수정할 수 있습니다. 변경된 약관은
            본 페이지에 게시된 때부터 적용되며, 중요한 변경은 합리적인 방법으로 안내합니다.
          </p>
        </section>

        <section>
          <h2>10. 문의</h2>
          <p>서비스 이용, 계정, 권한, 약관 관련 문의는 아래 이메일로 연락할 수 있습니다.</p>
          <p>
            <a href="mailto:d1.b2b.ax.3@gmail.com">d1.b2b.ax.3@gmail.com</a>
          </p>
        </section>

        <footer className="legal-footer">
          {/* 개인정보처리방침 링크 숨김 처리 */}
          {/* <a href="/privacy">개인정보처리방침</a> */}
          <Link href="/">홈으로 돌아가기</Link>
        </footer>
      </article>
    </main>
  );
}
