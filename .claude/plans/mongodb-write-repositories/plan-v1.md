# 구현 계획 v1
핵심 난이도: 암호화된 전체문서 갱신에서 누락 필드 보존·중복·관계 원자성 및 기존 PG 동작을 동시에 유지해야 한다.
1. [Core] 기존 코드의 입력→조회→변경→반환 계약 대조. undefined는 유지, 기존 string empty→null 변환 유지; 논리 식별자별 우선순위를 기존처럼 적용한다. Coach는 관련 profile/tags/audit를 하나의 transaction으로, TeamUser는 guard 갱신 후 정규화 이메일 중복검사와 생성, InstructorNote는 notionNo unique retry와 snapshot read+replace로 부분 수정 보존.
2. [Shell] shadow DB/namespace/explicit write gate와 준비된 validator/index를 요구하는 저장소 추가. 생산 factory 불변.
3. [Check] 독립 합성 테스트로 create→read→partial update 흐름·동시성·rollback·암호화 실패 차단 확인. 기존 PG reference는 mock 여부를 표시.
4. [Shell] 남은 실제 PG 의존 경로 inventory와 재개 문서 작성.
5. [Check] 표적/전체 테스트·타입·lint·build·diffcheck 및 독립 리뷰, native 미실행은 pass로 세지 않는다.
대안: 앱 전면 provider 전환은 아직 미구현 경로가 있어 제외. shadow adapter를 먼저 검증하고 공통 provider를 나중에 일괄 연결한다.
