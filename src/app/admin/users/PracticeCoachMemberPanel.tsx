import Link from "next/link";

export function PracticeCoachMemberPanel() {
  return (
    <div className="user-management">
      <p className="user-empty">
        실습코치 멤버는 코치 목록에서 관리합니다.
      </p>
      <Link className="user-add-btn" href="/coaches">
        코치 목록으로 이동
      </Link>
    </div>
  );
}
