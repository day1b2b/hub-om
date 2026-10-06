# 파일 가져오기 Mongo composition

2026-10-01 기준 관리자 xlsx 양식 다운로드와 파일 업로드 API에 `IMPORT_STAGING_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`만 준비된 namespace를 open-only로 연다. template은 request audit만, upload는 import staging·team member·instructor note·request audit를 한 잠금 scope로 연다.

기존 인증·파일 크기·CSV/JSON/xlsx parser·staging 응답은 변경하지 않았다. 실제 로컬 MongoDB에서 최소 scope, 암호화 sourceName, 감사, PG 무접근과 부분 namespace의 validator·index·행 불변을 검증했다. 운영 업로드·운영 DB·Atlas·키·배포 설정은 사용하지 않았고 실제 복사·복원·최종 전환은 남아 있다.
