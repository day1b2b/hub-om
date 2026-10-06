# 코치 접근 토큰 보완 CLI composition

`db:backfill:coach-access-tokens`는 backend 선택이 없으면 기존 PostgreSQL 경로를 그대로 사용한다. 정확히 한 번 지정한 `--backend=mongodb-shadow`만 Mongo를 선택하며, URI·database·`shadow_*` namespace가 유효하고 이미 준비된 토큰 보완 collection 전체가 일치할 때만 실행한다.

Mongo 선택은 새 namespace를 만들거나 기존 validator·index·문서를 수리하지 않는다. `--apply`에는 기존과 동일하게 `--backup-confirmed --maintenance-confirmed`가 모두 필요하다. 이 플래그는 실제 백업·복원 검증이나 쓰기 중단을 수행하지 않으므로 운영 실행 전 별도 확인이 필요하다.

합성 replica set에서 dry-run 무쓰기, apply 원자 갱신, 재실행 0건, 암호화 토큰 저장, 부분 namespace 무수정 거부를 확인했다. 운영 DB·키·실제 백업·배포 설정에는 접근하지 않았다.
