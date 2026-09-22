# 구현 계획 v2
v1 변경: guard 내부 contract와 삭제 차단을 명시하고 native 미실행을 별도 gap으로 남긴다. 범위는 repository 준비이며 runtime 전환 완료가 아니다.
1. [Core] Coach: API 기존 parse/trim/status/date/tag/profile 및 softdelete 계약을 새 repository에 수용. 관련 data와 content audit 한 transaction, auth/activity는 호출자가 담당하며 라우트 미연결.
2. [Core] TeamUser: 단일 guard 문서의 transaction write로 모든 새 repo mutation을 직렬화한 뒤 기존 공백·대소문자 무시 중복검사. 구writer를 포괄하지 않으므로 cutover 전 단일 경로 강제. delete는 정책 gap으로 failclosed.
3. [Core] InstructorNote: get(name)는 null NO 우선, save(name)는 기존 PG ascending NO(null last) 우선. NO기반은 unique predicate 및 duplicate retry. safe patch만 병합하고 생략 필드는 유지, 생성 때 필요한 날짜/UUID/default 명시. 기존 redaction도 유지하고 그 결과를 codec으로 암호화.
4. [Shell] 각 저장소는 explicit allowShadowWrites, replica/session 및 도메인 validator/index readiness 필요. setup은 명시적 함수만 실행; 정상 open에서 DDL 금지.
5. [Check] 단위/기존 reference mock/native 합성 경로 각각 실행·구분, 테스트는 loopback 명시 URI만 허용하고 실제 env값 자동사용 금지. 실패 시 원인 보완 후 재실행.
6. [Shell] 실제 PG 의존경로 inventory, 테스트 근거/미검증/gap 기록.
7. [Check] validation-v2 15항목 독립 리뷰 후 전체검증, 로컬commit 및 다음단계handoff. 생산 전환은 전체경로와 실제데이터/복구 검증 이후 별도 gate.

독립 계획 검토 반영: Coach optional 날짜의 빈값/형식불일치는 기존 null 변환, 형식을 통과한 Invalid Date는 저장 전 거부. Team 팀 수정은 not-found만 null, 암호화/DB 실패는 오류로 전파하여 실패 은폐를 개선. PG 업무 schema 불변과 별도 승인 내부 guard를 구분한다.
