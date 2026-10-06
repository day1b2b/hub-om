# Engagement boundary — clarify

기준 7ebb24f221b60d9180e7bbe8b82dd83120f49f79, feature/20260922-mongodb-coach-engagements, clean isolated checkout. 작업 시작 문서/DB 안전 규칙/이전 integration-review/runtime coverage 확인. development-harness Level3 및 validated-plan을 재사용한다.
목표: engagement 세 API의 목록/생성/수정/평가와 슬롯 교체·예약 자동취소·변경감사를 명시 repository 경계/transaction으로 구현한다. PG 기본 유지, 운영·외부서비스·실데이터·schema·keys·selector 변경 금지. feature commit/push 허용.
부모와 독립 정책 판독 합의: 일자전체 재예약 금지 없음. 예약→재생성은 취소+확정링크; 재생성→예약은 active 허용. CANCELLED 생성/날짜시간수정도 현행 재생성/취소, status-only는 없음. 현행 보존이지 새 권장 정책이 아니다.
성공: scope writer 전부 공통 guard 참여, 빈조건 write skew 차단, 실제handler auth/DTO/두순서경합/감사실패rollback/native Mongo8 및 전체검증, 독립리뷰. 외부 contractSheetSync/samsungScheduleSync는 별도 필수 후속이며 전체전환 완료로 보고하지 않는다.
