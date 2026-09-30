# Mongo 관리자 DB runtime 계획 v1

관리자 DB 페이지·셀 API가 실제로 요구하는 `adminDatabase`, `teamMembers`, `requestActivity`를 같은 등록·잠금 runtime으로 조립한다. 새 빈 shadow만 준비하고 부분 namespace는 자동 수리하지 않으며 생산 selector와 기존 업무 계약은 변경하지 않는다.
