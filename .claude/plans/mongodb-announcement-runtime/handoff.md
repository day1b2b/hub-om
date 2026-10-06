# Mongo 공지·첨부 runtime 인계

## 완료 상태

- 제품 커밋: `9a0c04e`
- 작업 브랜치: `feature/20261001-mongodb-announcement-runtime`
- 실제 API·페이지 조립, MongoDB 8.0.30 검증, 전체 회귀, 독립 수락 완료
- 운영 데이터·외부 원천·환경·배포 설정 변경 없음

## 다음 작업

다음 후보는 `/changes` 화면과 코치 메모·리뷰 쓰기 조립이다. `activityReads`, `coachContent`, `coachEngagement`, `requestActivity`의 실제 호출 그래프와 공유 coach guard를 먼저 대조해 한 화면의 조회와 쓰기가 같은 namespace에서 완결되는지 확인한다. 이미 등록된 활동 조회 runtime 객체나 공지 runtime의 audit 객체를 떼어 재사용하지 않는다.

operations 중심 core runtime은 Calendar 반영 포트를 함께 완결하기 전 raw Mongo 쓰기를 노출하면 안 된다.

## 계속 남는 외부 조건

- 실제 운영 PostgreSQL preflight 실행 결과
- 운영 Mongo namespace·권한·production selector·배포 결정
- 실제 A/B 독립 백업과 각각의 격리 복원·키 복구
- 실데이터 복사·최종 동기화·전환·무손실 복귀 검증
- 모든 조건 충족 뒤 dev 통합 및 dev→main 릴리스

현재 전체 서비스 이전은 완료되지 않았다.
