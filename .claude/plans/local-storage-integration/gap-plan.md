# Gap 보완
독립 /root/review_local 재현: receipt 없는 암호화 operations에 deterministic 요청 ID가 있으면 재시도 후 sameId=true, rows=2. V2/V4 조합 실패.
수정: receipt 없는 경우 요청 scope prefix로 현재 행을 조회. 1개+같은 fingerprint면 receipt 복구 후 replay; 다른 body 또는 여러 행이면 conflict, 원본 불변. 행과 receipt가 이미 모두 유실된 삭제 이력은 복구 불가능하므로 한계 명시.
검증: legacy 배열/객체 각각 동일·변경 요청 및 삭제 이후 재시도, 중복 legacy 행 거부. 관련 및 전체 test/typecheck/build 재검증.
