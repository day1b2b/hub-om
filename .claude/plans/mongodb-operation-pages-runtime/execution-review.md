# Mongo 운영 화면 runtime 실행 리뷰

제품 커밋은 `01e80adf82d6016064f530c3e6785db606d9d1de`다.

## 구현

- 새 shadow 준비와 일반 open을 분리했다.
- 여섯 Mongo repository와 borrowed 맞춤 도구 port를 단일 등록·잠금 scope로 묶었다.
- 실제 운영 목록·상세·신규 작성 page를 합성 actor와 실제 Mongo 저장소로 실행했다.
- PostgreSQL 주소는 실패 tripwire로 두고 외부 협업 원천은 명시 합성 port로 격리했다.
- 조회 전후 전체 collection snapshot과 불완전 namespace의 무수정 거부를 검사했다.

## 검증

- 실제 MongoDB 8.0.30 replica set: 1 pass / 0 skip / 0 fail
- 전체 일반 테스트(신규 실제 Mongo opt-in 포함): 1,163 pass / 133 skip / 0 fail
- typecheck/build: 통과
- 전체 lint: 오류 0 / 기존 경고 7
- 독립 리뷰: 최초 P1 1건·P2 2건을 보완했고 재검토에서 P0–P3 없음으로 수락

## 한계

- 실제 운영 데이터, 운영 PostgreSQL·MongoDB, 실제 협업 원천과 배포 설정에는 접근하지 않았다.
- 세 화면의 초기 조회만 다룬다. 운영 쓰기 API와 Calendar/request audit 조립은 후속 단위다.
- 생산 기본 backend는 PostgreSQL이며 운영 이전 완료로 해석하지 않는다.
