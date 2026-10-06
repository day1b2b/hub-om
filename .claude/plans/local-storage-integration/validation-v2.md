# Validation v2
구조: S1 모든 단계 태그, S2 Core>=1, S3 입력별 결정 규칙. 구조 실패 시 결과를 평가하지 않는다.
V1 전체 파일 암호화 및 local:operations AAD, V2 legacy 배열/객체 및 평문 허용 플래그, V3 생성/수정/삭제 후 receipt 보존, V4 동일 요청 replay 및 다른 body/삭제 conflict, V5 손상/복호화 실패 원본 bytes 불변, V6 0600, V7 두 인스턴스 동시 요청 무유실/중복 없음, V8 좁은 diff 및 lint/typecheck/test/build.
각 V는 clarify 요구사항에 일대일 대응. fixture raw bytes, payload, 행 수, 오류 타입과 명령 결과로 판정한다.

## v2 보강 및 테스트셋
V1: raw prefix 및 PII 부재, 복호화 payload에서 operations/receipts 동시 확인.
V2: 배열/operations-only/receipts 객체 모두 평문허용 true에서 읽기/암호화 전환; false에서 평문 거부 및 bytes 불변. 암호문은 false로 재읽기.
V3/V4: unrelated CRUD도 receipt 보존, 삭제 tombstone은 유효하며 replay conflict. 응답 분실을 새 인스턴스 재시도로 검사.
V5: receipt null/배열/문자열/잘못된 scope/ID 불일치, 잘못된 key/AAD/tamper는 독립 fixture로 검사. 암호화 키 누락, 임시파일 쓰기/rename 실패는 원본 bytes 및 임시파일 정리 확인. rename 성공 후 오류 가능한 부수 처리를 두지 않는다.
V6: 기존0644에서 새0600. temp에는 암호문만 기록.
V7: 동일 파일 여러 인스턴스, 정규화된 경로, 서로 다른 요청 동시 생성 및 같은 요청 재시도, 다른 파일 독립.
V8: 실제 실행과 논리검토 구분. DB 환경 없는 skip은 통과 아님. 현재 API/폼과 연결하지 않은 제한 기록.
