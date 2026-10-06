# Mongo 활동 조회 runtime 인계

## 완료 상태

- 제품 커밋: `c7d5e26`
- 작업 브랜치: `feature/20260930-mongodb-activity-read-runtime`
- 실제 세 GET 조립·MongoDB 8.0.30 검증·전체 회귀·독립 수락 완료
- 운영 데이터·외부 원천·환경·배포 설정 변경 없음

## 다음 작업

외부 원천이 없는 다음 작은 쓰기 단위로 공지·첨부 runtime을 검토한다. 기존 `MongoAnnouncementRepository`와 내부 운영 runtime의 request audit 계약을 같은 client/database/namespace에서 완전하게 조립하되, 등록된 scope 객체 일부를 떼어 재사용하지 않는다. 공지 작성·수정·첨부 다운로드·삭제의 실제 handler와 mutation·감사 원자성을 검증한다.

operations 중심 core runtime은 Calendar 반영 포트를 함께 완결하기 전 raw Mongo 쓰기를 노출하면 안 된다.

## 계속 남는 외부 조건

- 실제 운영 PostgreSQL preflight 실행 결과
- 운영 Mongo namespace·권한·production selector·배포 결정
- 실제 A/B 독립 백업과 각각의 격리 복원·키 복구
- 실데이터 복사·최종 동기화·전환·무손실 복귀 검증
- 모든 조건 충족 뒤 dev 통합 및 dev→main 릴리스

현재 전체 서비스 이전은 완료되지 않았다.
