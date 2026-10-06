# Mongo runtime 조립 인계

## 완료 상태

- 제품 커밋: `13ac521`
- 작업 브랜치: `feature/20260930-mongodb-runtime-composition`
- PostgreSQL runtime preflight 구현·합성 검증·독립 수락 완료
- 운영 데이터·환경·배포 설정 변경 없음

## 다음 작업

같은 Mongo client/database/namespace에서 한 요청에 필요한 repository 묶음을 여는 공용 runtime composition을 구현한다. 첫 수직 단위는 외부 원천이나 운영 selector가 필요 없는 health·관리자 backup·activity request/prune처럼 이미 구현된 내부 운영 경계를 묶는 방향으로 실제 호출 그래프를 다시 확인한다.

Mongo 저장소의 shadow write gate를 우회하거나 운영 namespace 이름을 임의로 정하지 않는다. 부분 scope가 다른 endpoint를 기본 PostgreSQL로 조용히 섞지 않도록 fail-closed 계약과 borrowed-client lifecycle을 검증한다.

## 계속 남는 외부 조건

- 실제 운영 PostgreSQL preflight 실행 결과
- 운영 Mongo namespace·권한·배포 selector 결정
- 실제 A/B 독립 백업과 각각의 격리 복원·키 복구
- 실데이터 복사·최종 동기화·전환·무손실 복귀 검증
- 전체 조건 충족 뒤 dev 통합 및 dev→main 릴리스

현재 전체 서비스 이전은 완료되지 않았다.
