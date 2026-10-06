# 독립 리뷰 보완 계획

Gibbs 최종 검토에서 V7 저장 Bytes 비교의 P2 테스트 결함을 확인했다. BSON Binary와 Uint8Array의 객체 타입 차이만으로 통과할 수 있고, 빈 첨부의 원본을 구분하지 않았다. 제품 암호화 코드는 변경하지 않는다.

- PG row_to_json의 bytea hex와 Mongo Binary subtype 0의 실제 바이트를 Buffer로 정규화한다.
- 첨부 ID별 원본(빈 파일 포함)과 Buffer.equals로 다름을 검증한다. 평문 Binary/bytea를 입력하면 검사가 실패하는 음성 테스트를 추가한다.
- V9의 기존 동시 추가 한계를 명시적으로 검증한다. 4개 첨부의 두 사전 조회가 각각 추가 허용을 판정한 뒤 실제 writer 충돌·재시도로 6개가 되고, 추가 유실/중복 감사가 없는지 확인한다. 새 제한 정책은 넣지 않는다.
- 실제 PG 대조·native Mongo·변경 테스트 typecheck/lint를 실행한다. 수정 전 handler fixture가 로드되어 실패한 전체 Mongo 회귀는 완료 결과를 보존한 뒤 최종 파일로 재실행한다.
- 독립 최종 수락 전 PASS로 기록하지 않는다. oracle와 제품 코드는 그대로 유지한다.
