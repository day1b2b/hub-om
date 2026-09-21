# Validation v1
구조: S1 모든 단계 태그, S2 Core>=1, S3 입력별 결정 규칙. 구조 실패 시 결과를 평가하지 않는다.
V1 전체 파일 암호화 및 local:operations AAD, V2 legacy 배열/객체 및 평문 허용 플래그, V3 생성/수정/삭제 후 receipt 보존, V4 동일 요청 replay 및 다른 body/삭제 conflict, V5 손상/복호화 실패 원본 bytes 불변, V6 0600, V7 두 인스턴스 동시 요청 무유실/중복 없음, V8 좁은 diff 및 lint/typecheck/test/build.
각 V는 clarify 요구사항에 일대일 대응. fixture raw bytes, payload, 행 수, 오류 타입과 명령 결과로 판정한다.
