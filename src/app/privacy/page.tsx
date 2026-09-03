import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "개인정보처리방침 | hub-om",
  description: "hub-om 개인정보처리방침"
};

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <article className="legal-document">
        <header className="legal-header">
          <Link className="legal-brand" href="/">
            hub-om
          </Link>
          <p className="eyebrow">Privacy Policy</p>
          <h1>개인정보처리방침</h1>
          <p className="lede">
            hub-om은 기업교육 운영 현황을 관리하기 위한 내부 업무 도구입니다. 본 방침은
            hub-om이 Google 계정 로그인 및 Google API를 통해 접근하는 사용자 데이터의
            처리 기준을 설명합니다.
          </p>
          <p className="legal-updated">시행일: 2026-09-01</p>
          <p className="legal-updated">최종 수정일: 2026-09-02</p>
        </header>

        <section>
          <h2>1. 수집하는 정보</h2>
          <p>hub-om은 서비스 제공과 접근 권한 확인을 위해 다음 정보를 처리할 수 있습니다.</p>
          <ul>
            <li>Google 로그인 기본 정보: 이름, 이메일 주소, 프로필 이미지, 계정 식별 정보</li>
            <li>권한 확인 정보: 허용된 Google Workspace 도메인 여부 및 로그인 세션 정보</li>
            <li>
              Google Sheets 읽기 전용 데이터: 사용자 또는 운영자가 지정한 시트 URL, 탭과 셀 값.
              가져오기·반영 기능으로 저장한 값은 hub-om 데이터베이스에 보관하며, 원본 시트는
              수정하지 않습니다.
            </li>
            <li>
              Google Calendar 일정 데이터: 연동 대상으로 설정된 캘린더와 일정의 식별자, 제목,
              설명, 장소, 시작·종료 시각, 시간대, 원문 링크와 API 처리 상태. 교육 일정 생성과
              초대에는 과정 정보, 담당자·현장 운영 담당자·강사의 이름과 초대 대상 담당자의 이메일
              주소를 사용할 수 있습니다.
            </li>
            <li>
              운영 업무 데이터: 과정명, 일정, 담당자, 운영 이슈, 자료 후보, 사용자가 hub-om에
              입력하거나 검토한 업무 기록
            </li>
            <li>
              서비스 운영 정보: 접속 시각, 요청 경로, 오류 기록, 보안 및 장애 대응에 필요한
              기술 로그
            </li>
          </ul>
        </section>

        <section>
          <h2>2. Google 사용자 데이터 사용 목적</h2>
          <p>
            hub-om은 Google 사용자 데이터를 기업교육 운영 업무를 지원하는 목적으로만 사용합니다.
          </p>
          <ul>
            <li>허용된 회사 Google Workspace 계정인지 확인하고 로그인 세션을 유지</li>
            <li>사용자 또는 운영자가 지정한 Google Sheets의 셀 값을 읽어 교육 운영 데이터로 가져오기</li>
            <li>
              hub-om 운영 정보에 따라 설정된 파트별 Google Calendar에 교육 일정을 생성·수정·삭제하고
              담당자를 초대
            </li>
            <li>조회용으로 연결된 Google Calendar의 일정과 부재 정보를 읽어 업무 일정 확인을 지원</li>
            <li>오류 분석, 보안 점검, 접근 통제, 서비스 안정성 개선</li>
          </ul>
        </section>

        <section>
          <h2>3. Google Sheets 및 Google Calendar 데이터 처리 방식</h2>
          <p>
            회사 계정 로그인은 사용자를 식별하고 hub-om에 대한 접근을 확인하는 절차입니다. 앱에
            로그인한 계정과 Google API 호출에 사용하는 계정이 항상 같은 것은 아닙니다.
          </p>
          <p>
            만족도 매칭 기능은 기본적으로 비활성화되어 있으며, 비활성화 중에는 해당 화면과 API를
            통한 시트 조회·반영을 실행하지 않습니다. 운영자가 활성화한 경우에는 B2B 공용 Google
            계정의 OAuth 권한으로 지정된 스프레드시트의 탭과 셀 값을 읽습니다. 미리보기로 조회한
            값을 검토한 뒤 반영하거나 연결하면, 관련 만족도 값과 연결 정보를 hub-om 데이터베이스에
            저장합니다. 이 기능에서
            Google Sheets에 접근할 수 있는 범위는 로그인한 직원 개인이 아닌 공용 계정의 권한에
            따라 결정됩니다.
          </p>
          <p>
            별도의 사용자 OAuth 기반 시트 가져오기에서는 해당 사용자가 승인한 읽기 권한으로 탭과
            셀 값을 조회하고 가져온 데이터를 데이터베이스에 저장합니다. 일부 업무 시트 조회는
            운영자가 설정한 서비스 계정의 권한을 사용합니다. 각 연동 계정에 접근 권한이 있는
            원천만 읽으며, hub-om은 원본 스프레드시트를 수정하거나 삭제하지 않습니다.
          </p>
          <p>
            교육 일정 반영 기능은 B2B 공용 계정의 OAuth 권한으로 설정된 파트별 캘린더에 일정을
            생성하고 담당자와 현장 운영 담당자를 참석자로 초대합니다. hub-om의 운영 정보가
            수정되거나 삭제되면 연결된 Google Calendar 일정도 갱신하거나 삭제합니다. 직원
            개인의 Calendar OAuth 권한으로 개인 캘린더를 직접 수정하는 방식은 아닙니다.
          </p>
          <p>
            일정과 참석자 이메일은 초대 및 변경 알림을 위해 Google에 전달됩니다. 일정 정보는
            캘린더와 초대의 공유 설정에 따라 참석자와 캘린더 열람자에게 표시될 수 있습니다.
            초대 일정이 직원의 캘린더에 표시되는 시점은 해당 직원의 Google Calendar 초대 설정과
            수락 여부에 따라 달라집니다.
          </p>
          <p>
            일정 조회 기능은 별도로 설정된 서비스 계정의 읽기 권한으로 연결된 캘린더의 제목,
            시작·종료 시각과 원문 링크 등을 읽고 업무 일정이나 부재 정보를 표시할 수 있습니다.
            hub-om은 캘린더의 공유 권한, 액세스 제어 목록(ACL), 소유권 또는 기타 캘린더 설정을
            변경하지 않습니다. Gmail API로 직원의 메일함을 검색하거나 메일 본문을 읽지 않습니다.
          </p>
        </section>

        <section>
          <h2>4. 보관 및 삭제</h2>
          <p>
            로그인 세션과 업무 기록은 서비스 제공, 보안, 감사, 장애 대응에 필요한 기간 동안
            보관합니다. Google API로 조회한 원천 데이터는 업무 후보 확인에 필요한 범위에서만
            처리하며, 불필요한 원문 데이터 저장을 제한합니다.
          </p>
          <p>
            Google Calendar 일정 원본은 Google Calendar에 저장됩니다. hub-om이 Calendar 연동을 위해
            처리하는 일정 식별자와 관련 업무 기록은 해당 교육 과정과 연동 기능을 제공하는 데 필요한
            기간 동안 보관할 수 있습니다.
          </p>
          <p>
            계정 접근 권한 철회 또는 데이터 삭제 요청이 있으면 운영 목적, 법적 의무, 보안상
            필요한 보관 범위를 제외하고 합리적인 기간 내에 처리합니다.
          </p>
        </section>

        <section>
          <h2>5. 공유 및 제3자 제공</h2>
          <p>
            hub-om은 Google 사용자 데이터를 광고 목적으로 판매하거나 공유하지 않습니다. 또한 Google
            사용자 데이터를 일반화된 AI 또는 머신러닝 모델 학습 목적으로 사용하지 않습니다.
          </p>
          <p>다음 경우에만 필요한 범위에서 정보가 처리될 수 있습니다.</p>
          <ul>
            <li>교육 일정 생성·수정·삭제 및 담당자 초대를 위한 Google Calendar 처리와 일정 공유</li>
            <li>서비스 호스팅, 데이터베이스, 인증, 로그 관리 등 운영에 필요한 위탁 처리</li>
            <li>법령, 수사기관 요청, 분쟁 대응 등 법적 의무 이행</li>
            <li>사용자 또는 조직 관리자의 명시적 요청에 따른 지원 처리</li>
          </ul>
        </section>

        <section>
          <h2>6. Google API Services User Data Policy 준수</h2>
          <p>
            hub-om의 Google API 사용과 Google 사용자 데이터 이전은 Google API Services User Data
            Policy 및 Limited Use 요구사항을 준수합니다. Google 사용자 데이터는 사용자가 승인한
            기능 제공과 보안, 장애 대응, 법적 의무 이행에 필요한 범위로 제한됩니다.
          </p>
        </section>

        <section>
          <h2>7. 사용자 선택권</h2>
          <p>사용자는 Google 계정 보안 설정에서 hub-om에 부여한 접근 권한을 철회할 수 있습니다.</p>
          <ul>
            <li>Google 계정의 보안 설정에서 타사 앱 접근 권한을 삭제</li>
            <li>조직 관리자 또는 hub-om 운영자에게 계정 접근 해제 요청</li>
            <li>개인정보 열람, 정정, 삭제, 처리 제한 요청</li>
          </ul>
          <p>
            직원 개인이 Google 계정에서 hub-om의 OAuth 권한을 철회하면 해당 개인에게서 부여받은
            권한을 더 이상 사용할 수 없습니다. 다만 별도로 연결된 B2B 공용 계정이나 서비스 계정의
            권한까지 철회되는 것은 아닙니다. 공용 계정 연동 해제, 일정 초대 중단 또는 저장된
            업무 데이터 삭제는 hub-om 운영자에게 요청할 수 있습니다.
          </p>
          <p>
            접근 권한 철회만으로 이미 저장된 업무 데이터나 Google Calendar 일정이 자동으로
            삭제되지는 않습니다. 공용 일정의 수정·삭제는 hub-om에서 허용된 운영 정보 수정·삭제
            기능을 이용하거나 운영자에게 요청할 수 있습니다. 초대받은 직원이 본인 Google
            Calendar에서 일정을 제거하는 것은 공용 원본 일정을 모든 참석자에게서 삭제하는 것과
            다릅니다.
          </p>
        </section>

        <section>
          <h2>8. 보안</h2>
          <p>
            hub-om은 접근 권한을 허용된 회사 Google Workspace 계정으로 제한하고, 인증 정보와 API
            비밀값을 공개 저장소에 저장하지 않습니다. 운영 환경의 비밀값은 배포 환경의 보안 저장소에서
            관리합니다.
          </p>
        </section>

        <section>
          <h2>9. 문의</h2>
          <p>
            개인정보 처리, Google 데이터 접근, 권한 철회, 삭제 요청은 아래 이메일로 문의할 수
            있습니다.
          </p>
          <p>
            <a href="mailto:d1.b2b.ax.3@gmail.com">d1.b2b.ax.3@gmail.com</a>
          </p>
        </section>

        <section>
          <h2>10. 개인정보보호책임자 및 관련 부서</h2>
          <p>
            회사는 개인정보 처리에 관한 업무를 총괄해서 책임지고, 개인정보 처리와 관련한 사용자의
            불만처리 및 피해구제 등을 위하여 아래와 같이 개인정보보호책임자를 지정하고 있습니다.
            회사의 서비스(또는 사업)을 이용하면서 발생한 모든 개인정보 보호 관련 문의, 불만처리,
            피해구제 등에 관한 사항을 개인정보보호책임자 및 담당부서로 문의하실 수 있습니다. 회사는
            지원자의 문의에 대해 지체 없이 답변 및 처리해드릴 것입니다.
          </p>
          <p>
            <strong>1. 개인정보보호책임자</strong>
          </p>
          <ul>
            <li>성명: 김동혁</li>
            <li>연락처: 02-501-9396 / help@fastcampus.co.kr</li>
          </ul>
          <p>
            <strong>2. 개인정보 열람청구 접수·처리 부서</strong>
          </p>
          <ul>
            <li>부서명: 고객센터</li>
            <li>연락처: 02-501-9396 / tm@day1company.co.kr</li>
          </ul>
        </section>

        <footer className="legal-footer">
          <a href="/terms">서비스 약관</a>
          <Link href="/">홈으로 돌아가기</Link>
        </footer>
      </article>
    </main>
  );
}
