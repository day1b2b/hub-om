# Mongo 변경 내역 runtime 인계

## 완료 상태

- 제품 커밋: `f8bdf90`
- 작업 브랜치: `feature/20261001-mongodb-changes-runtime`
- 실제 네 API handler 조립, MongoDB 8.0.30 검증, 전체 회귀, 독립 수락 완료
- 운영 데이터·외부 원천·환경·배포 설정 변경 없음

## 다음 작업

다음 runtime 조립 단위는 최신 coverage와 실제 호출 그래프를 다시 대조해 선택한다. 이미 완료된 repository를 반복 구현하지 않고, 외부 원천이나 Calendar 부작용이 없는 작은 수직 단위를 우선한다. operations 중심 core runtime은 Calendar 반영 포트를 함께 완결하기 전 raw Mongo 쓰기를 노출하면 안 된다.

## 계속 남는 외부 조건

- 실제 운영 PostgreSQL preflight 실행 결과
- 운영 Mongo namespace·권한·production selector·배포 결정
- 실제 A/B 독립 백업과 각각의 격리 복원·키 복구
- 실데이터 복사·최종 동기화·전환·무손실 복귀 검증
- 모든 조건 충족 뒤 dev 통합 및 dev→main 릴리스

현재 전체 서비스 이전은 완료되지 않았다.
