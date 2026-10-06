# Mongo 내부 운영 runtime scope 인계

## 완료 상태

- 제품 커밋: `4efc4f8`
- 작업 브랜치: `feature/20260930-mongodb-runtime-scope`
- 명시 shadow 내부 운영 scope 구현·실제 Mongo 검증·전체 회귀·독립 수락 완료
- 운영 데이터·환경·배포 설정 변경 없음

## 다음 작업

총괄 coverage와 실제 호출 그래프를 기준으로 다음 미전환 수직 단위를 선택한다. 우선순위는 외부 원천과 생산 selector를 건드리지 않고도 한 요청의 Mongo 저장소 묶음을 완결할 수 있는 core app runtime 경계다. 이미 전환된 개별 저장소를 다시 구현하지 않고, 누락 포트가 PostgreSQL 기본값으로 조용히 섞이지 않도록 완전성 검사와 명시 scope를 검증한다.

활성 Next 요청·CLI·예약 작업 연결은 각 진입점의 인증·부작용·원천 adapter 계약을 확인한 뒤 별도 범위로 진행한다.

## 계속 남는 외부 조건

- 실제 운영 PostgreSQL preflight 실행 결과
- 운영 Mongo namespace·권한·production selector·배포 결정
- 실제 A/B 독립 백업과 각각의 격리 복원·키 복구
- 실데이터 복사·최종 동기화·전환·무손실 복귀 검증
- 모든 조건 충족 뒤 dev 통합 및 dev→main 릴리스

현재 전체 서비스 이전은 완료되지 않았다.
