# MongoDB 활동 조회 runtime

관리자 활동 목록, 이용 현황, 비공개 활동 피드의 기존 `activityReads` 저장소를 하나의 명시 Mongo shadow runtime으로 연다. 저장소 구현을 반복하지 않고 실제 GET handler가 같은 client/database/namespace의 등록된 scope만 사용하게 검증하는 조립 단계다.

## 범위

- `GET /api/admin/activity`
- `GET /api/admin/activity/usage`
- `GET /api/activity-feed`
- `activityReads` 포트와 기존 8개 조회 모델

세 GET은 자기 조회가 통계에 다시 쌓이지 않도록 기존 route policy에서 요청 감사 제외다. 따라서 이 runtime은 `requestActivity`나 보존 삭제를 포함하지 않는다. `/changes` 화면의 코치 메모·리뷰 쓰기와 전체 앱 backend 선택도 이 범위가 아니다.

## 준비와 열기

`prepareMongoActivityReadRuntime`은 쓰기 gate가 있는 새 shadow namespace에서만 validator와 index를 준비한다. 정확한 namespace의 알려진 runtime collection이 하나라도 있으면 준비·수리·삭제하지 않고 `openMongoActivityReadRuntime`의 전체 readiness만 실행한다.

`openMongoActivityReadRuntime`은 읽기 전용 조립이므로 쓰기 허용 플래그를 받지 않는다. 준비 작업이나 client 종료도 하지 않는다. 부분 준비, 오래된 validator/index, 손상된 암호문은 고정 runtime 오류로 실패한다.

namespace 소유권 확인은 모든 runtime 모델과 알려진 내부 collection의 정확한 이름을 비교한다. 겹치는 prefix나 이 runtime 밖의 모델만 존재하는 namespace도 비어 있다고 오판하지 않는다.

## 확인한 범위

새 로컬 MongoDB 8.0.30 replica set과 합성 키·데이터에서 다음을 확인했다.

- 실제 세 GET의 인증·필터·KST 날짜·cursor·DTO·오류 계약
- 관리자 활동·이용 현황과 전용 키 활동 피드
- 준비된 namespace 재실행과 read-only open의 mutation 0
- 다른 runtime 모델만 있는 부분 namespace의 자동 수리·삭제·mutation 0
- 서로 다른 runtime의 중첩 scope 전환 차단
- PostgreSQL fallback·외부 요청 0, 조회 중 감사·업무 데이터 쓰기 0
- 암호문 손상과 저장소 실패의 고정 응답 및 개인정보 비노출
- borrowed client를 runtime이 닫지 않음

생산 selector, 전체 Next 서버, `/changes`의 쓰기 기능, 운영 namespace·권한·부하, 실제 데이터 이전·백업·복원·최종 전환은 확인하지 않았다.
