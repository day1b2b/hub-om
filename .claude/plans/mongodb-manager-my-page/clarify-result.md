# 담당자 내 페이지 저장 경계

기준 bc77a12758bd060a4194b6489dd14c4eaa63074d, feature/20260929-mongodb-manager-my-page. 이전 콘텐츠 기능은 총괄 통합 완료이므로 재구현하지 않는다.

목표: 담당자 내 페이지의 예약·확정 과정을 기존 계약대로 조회하는 PG 기본/명시 Mongo 경계. token backfill은 후속이다. 실제 관리자 page가 세션 email만 사용하며 검색파라미터로 타담당자를 지정하지 않는다.

기존 계약: 예약 이메일은 exact equality(정규화하지 않음); 확정 링크는 cancelledAt과 무관; 예약의 coach가 engagement의 coach와 다를 때도 기존 예약 coach를 보존한다. roster는 createdAt 내림차순 후 trim/lower email의 첫 이름, 역할제한 없음. hiredByText는 원래 이름 case-sensitive contains와 split/normalize 모두 만족. linked engagement 우선 중복제거, 과정명 그룹·기간 최소최대·상태라벨·활성슬롯·정렬·분류 보존. 삭제코치도 임의 제외하지 않는다.

제약: 운영/Atlas/실제원천/키/env/배포/main/dev/원본/총괄clone 변경 없음. schema/dependency/삭제정책 추가 없음. 새 loopback 합성DB·임시키 검증 후 정리. 기능검증/전체운영완료 구분.

열린 제품 결정 없음. 동일 이름 담당자의 기존 자유텍스트 매칭 모호성은 보존·기록하며 신규 권한정책을 임의로 추가하지 않는다.
