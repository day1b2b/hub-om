# Mongo 내부 운영 runtime scope 계획 v1

## 목표

이미 구현된 health·관리자 backup·request/private audit·activity prune를 같은 명시 Mongo namespace로 조립하고, 부분 구성이나 요청 중 namespace 전환을 차단한다.

## 선택

1. 모든 `DataRepositories`를 한 번에 조립하면 외부 Google/Notion/Slack source와 아직 결정되지 않은 생산 selector까지 섞인다.
2. health만 조립하면 저장·감사·CLI가 같은 namespace를 쓴다는 사실을 검증하지 못한다.
3. 외부 원천이 없는 내부 운영 포트 다섯 개를 첫 수직 단위로 묶는다.

3번을 선택한다. 운영 selector는 추가하지 않는다.

## 안전 계약

- 빈 namespace만 준비
- 기존 namespace는 read-only open readiness만 허용
- 부분/오래된 namespace 자동 수리·삭제 금지
- client/database/namespace 단일 입력
- scope 전체 잠금과 nested 교체 차단
- borrowed client lifecycle 유지
