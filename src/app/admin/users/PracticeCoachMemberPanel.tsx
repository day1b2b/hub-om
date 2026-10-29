import Link from "next/link";

export function PracticeCoachMemberPanel() {
  return (
    <div className="user-management">
      <p className="user-empty">
        실습코치 멤버는 코치 위키에서 관리합니다. 노션 실습코치 DB 연동을 통해 자동 등록될 예정입니다.
      </p>
      <Link className="user-add-btn" href="/coaches">
        코치 위키로 이동
      </Link>
    </div>
  );
}
