# Plan v1 검토
구조 S1/S2/S3 PASS: 입력필드→복호화→필터/정렬/DTO 변환 Core 있음.
실행 전 수정 1건: 전역 OPERATION_MODELS 확대는 기존 생성 기능과 unrelated Coach 준비를 결합하므로 domain별 model set을 받는 store를 추가한다. 기존 store 기본값과 factory 유지.
독립 조회는 snapshot 보장이 없음을 문서화. 실패 시 기본값으로 숨기지 않는다. 모든 15항목은 아직 구현 전이므로 pass로 선언하지 않는다.
