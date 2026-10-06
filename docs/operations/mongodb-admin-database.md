# 관리자 DB 조회·셀 편집 경계

관리자 DB의 기존 8개 표 조회와 기업·과정·구성원·운영 회차의 허용 셀 편집을 `adminDatabase` repository로 분리한다. 기본 backend는 PostgreSQL이며 명시 내부 context에서만 Mongo를 사용한다. 운영 backend selector나 사용자 권한은 변경하지 않는다.

## 표시와 저장

기존 표 순서·건수·최대100개 미리보기·셀 label/value/rawValue/options/tone·관계 연결·서울 시각·JSON 요약을 유지한다. 삭제된 운영 회차도 기존처럼 조회·편집할 수 있다. Member는 활성순·표시순서(NULLS LAST)·갱신시각순이며 완전 동률만 Mongo의 _id로 보조 정렬한다. PG의 16개 독립 조회와 Mongo의 단일 snapshot은 동시 변경 중 완전히 같은 화면을 보장하지 않는다.

표시는 기존 formatter를 공통 presenter로 추출한다. 검증 oracle은 원본 query와 formatter 전체를 별도 동결하여 함께 잘못 바뀌는 자기검증을 피한다. 조회 응답의 승인된 복호화 값은 저장 평문 유출과 구분한다. 기존 JSON scalar 요약과 중복 오류의 입력 이름 안내도 그대로 유지하며, 모든 응답이 개인정보 없는 요약이라는 뜻은 아니다.

셀 편집은 기존 ADMIN_EDITABLE_FIELDS만 허용한다. 새 필드·삭제 기능을 추가하지 않는다. Company/Member 이름 변경 시 정규화명을 함께 갱신하고 Member 개인정보와 HMAC를 함께 저장한다. OperationSession만 수정자와 필요한 암호화 companion을 갱신한다. 일반 운영 편집의 추가 계산을 재사용하지 않고 허용 필드만 부분 갱신한다. unique 위반/없는 행/그 밖의 오류는 기존 상태와 안내로 매핑한다. UUID 허용 표기는 실제 PG 기준으로 비교하며, UI에서 nullable이어도 schema가 거부하는 요청은 성공시키지 않는다.

Mongo는 업무 쓰기와 변경 감사를 하나의 transaction으로 처리한다. 기존 writer와 같은 문서에서 충돌하면 최신 값을 다시 읽고 부분 갱신하므로 다른 필드를 덮어쓰지 않는다. Member 감사의 공개값은 기존 PG trigger의 role/sourceTeam만이며 개인정보 필드는 가린다. 이후 기록하는 요청 감사의 장애는 이미 성공한 업무를 취소하지 않는다.

## 페이지와 범위

페이지의 담당자 목록은 `teamMembers` context를 `getStoredTeamMemberRepository`에 연결해 기존 Mongo 읽기 저장소를 주입한다. scope 밖의 PG/local 선택은 유지한다. 일반 `getTeamMemberRepository`의 Notion 정책은 이번 범위 밖으로 남기며 저장용 factory 연결만으로 전체 팀/원천 경로 전환 완료를 주장하지 않는다.

명시 shadow 준비만 validator/index를 구성하며 open과 업무 호출은 자동 수리하지 않는다. 운영 데이터·실 Notion/Google·환경/배포에 접근하지 않고 격리 합성 PG/Mongo에서만 검사한다. 실행·실패·독립 리뷰·통합 SHA 및 한계는 `.claude/plans/mongodb-admin-database/`를 따른다.

이번 경계 완료는 전체 앱 전환이나 실제 데이터 이전·복구 리허설·최종 운영 전환 완료가 아니다. 브라우저/OAuth와 운영 부하는 별도 검증 대상이다.
