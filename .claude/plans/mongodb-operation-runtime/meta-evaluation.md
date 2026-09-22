# Architect evaluation — 독립 reviewer sql_review

native transaction/scope claim 설계 유효. counter 출처 및 경쟁, retry 횟수, readiness 옵션 비교가 미정. roundtrip만으로 공유 오류를 발견하지 못하므로 independent golden 필요. 32MiB 검색 한도, HMAC 동일 감사 생략, null/누락 구분 및 취소된 claim/counter rollback 추가 필요. fake transaction 테스트는 서버 원자성 증거가 아님.
