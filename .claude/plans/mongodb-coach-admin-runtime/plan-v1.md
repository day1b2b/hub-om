# Mongo 코치 관리자 runtime 계획 v1

코치 관리자 페이지와 마스터·삭제 코치 API가 사용하는 `coachAdmin`, `requestActivity`를 같은 client/database/namespace의 등록·잠금 scope로 조립한다. 새 빈 shadow만 준비하고 부분 namespace는 자동 수리하지 않는다. 기존 영구삭제 정책과 생산 기본 PostgreSQL은 변경하지 않는다.
