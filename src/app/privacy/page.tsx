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
          <p className="legal-updated">시행일: 2026-06-16</p>
        </header>

        <section>
          <h2>1. 수집하는 정보</h2>
          <p>hub-om은 서비스 제공과 접근 권한 확인을 위해 다음 정보를 처리할 수 있습니다.</p>
          <ul>
            <li>Google 로그인 기본 정보: 이름, 이메일 주소, 프로필 이미지, 계정 식별 정보</li>
            <li>권한 확인 정보: 허용된 Google Workspace 도메인 여부 및 로그인 세션 정보</li>
            <li>
              Gmail 읽기 전용 데이터: 사용자가 승인한 범위에서 과정 관련 메일 후보를 찾기 위한
              제목, 발신자, 수신자 또는 참조자, 날짜, 메시지 식별자, 스니펫, 라벨 등 메타데이터
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
            <li>운영 상세 화면에서 과정과 관련된 Gmail 논의 후보를 읽기 전용으로 조회</li>
            <li>운영 담당자가 메일 제목, 발신자, 날짜, 스니펫을 확인해 관련 논의를 찾도록 지원</li>
            <li>Google Drive, Sheets, Calendar 연동이 설정된 경우 운영 자료와 일정 후보를 읽기 전용으로 확인</li>
            <li>오류 분석, 보안 점검, 접근 통제, 서비스 안정성 개선</li>
          </ul>
        </section>

        <section>
          <h2>3. Gmail 데이터 처리 방식</h2>
          <p>
            hub-om은 Gmail API를 읽기 전용으로 사용합니다. 과정 관련 후보를 찾기 위해 검색 결과와
            메타데이터를 조회하며, 메일 본문 전체를 저장하지 않습니다. 화면에는 운영자가 판단할 수
            있는 최소한의 제목, 발신자, 날짜, 스니펫, 원문 링크만 표시합니다.
          </p>
          <p>
            hub-om은 사용자의 Gmail 메시지를 전송, 수정, 삭제하거나 사용자를 대신해 메일을 작성하지
            않습니다.
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

        <footer className="legal-footer">
          <a href="/terms">서비스 약관</a>
          <Link href="/">홈으로 돌아가기</Link>
        </footer>
      </article>
    </main>
  );
}
