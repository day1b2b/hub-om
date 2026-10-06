# Mongo 운영 화면 runtime 인계

- 작업 브랜치: `feature/20261001-mongodb-operation-app-runtime`
- 기준 총괄 SHA: `7a363c24c0e6621be6269596e6a0beb256bb8133`
- 범위: 운영 목록·상세·신규 작성 화면의 초기 서버 조회를 하나의 명시 Mongo shadow scope로 조립
- 포함 port: `operations`, `teamUsers`, `teamMembers`, `instructorNote`, `coach`, `omRequests`, borrowed `omCustomTools`
- 제외: 운영 생성·수정·삭제 API, Calendar 부수 작업, request audit, production selector, 운영 데이터와 외부 원천
- 제품 커밋: `01e80adf82d6016064f530c3e6785db606d9d1de`
- 실제 Mongo page 검증과 전체 회귀·독립 리뷰 완료
- 다음 단위: 운영 쓰기 API와 Calendar/request audit의 명시 runtime 조립
- 실제 A/B 백업·각 복원·복사·최종 전환 및 `dev`→`main`은 미완료
