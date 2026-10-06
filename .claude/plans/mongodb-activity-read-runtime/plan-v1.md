# Mongo 활동 조회 runtime 계획 v1

## 목표

완료된 `MongoActivityReadRepository`를 실제 세 GET이 공유하는 명시 runtime으로 조립하고, scope 누락 시 PostgreSQL로 조용히 내려가지 않으며 기존 namespace를 자동 수리하지 않는지 검증한다.

## 대안 비교

1. operations·coach·명단을 core runtime으로 묶으면 주요 페이지를 넓게 덮지만 `operations` 쓰기의 Calendar 반영 계약까지 함께 해결해야 한다. raw Mongo operation 저장소를 노출하면 기존 동작이 빠질 위험이 있어 보류한다.
2. 공지 runtime은 독립 CRUD를 완결하지만 첨부·업무 감사·request audit·coach scheduling guard까지 동시에 조립해야 한다.
3. 활동 조회 runtime은 단일 포트이고 세 GET이 요청 감사 제외인 읽기 전용 수직 단위다.

3번을 선택한다. 기존 handler·repository 구현은 바꾸지 않고 조립과 준비 안전성만 추가한다.

## 안전 계약

- 새 빈 shadow namespace만 준비
- 알려진 collection이 있으면 read-only open만 수행
- 정확한 collection 이름으로 namespace 소유권 판정
- open에는 쓰기 capability를 요구하거나 전달하지 않음
- registered scope와 실행 전체 잠금으로 중첩 교체 차단
- borrowed client lifecycle 유지
- 실제 운영·외부 원천·production selector 불변
