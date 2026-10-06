# Drive 가져오기 CLI composition

`drive:import:dry-run`은 backend 선택이 없으면 기존 PostgreSQL 경로와 `.env` → `.env.local` 덮어쓰기 순서를 그대로 사용한다. 정확히 한 번 지정한 `--backend=mongodb-shadow`만 Mongo를 선택하며, URI·database·`shadow_*` namespace와 개인정보 키가 유효하고 기존 Drive writer collection 전체가 준비된 경우에만 실행한다.

명령 이름이 dry-run이어도 `DriveImportRun`과 `DriveImportResult` 이력은 저장한다. Mongo 경로는 새 namespace를 만들거나 validator·index·문서를 수리하지 않는다. 불완전한 namespace는 Drive source 호출 전에 고정 오류로 거부하고 PostgreSQL로 되돌아가지 않는다. Mongo 선택 시 로컬 `.env` 파일도 읽지 않는다.

로컬 MongoDB 8.0.30 replica set과 합성 source에서 실제 CLI selector, 이력 생성, `DriveImportResult.companyName/courseName` 암호문 저장, 부분 namespace 전체 불변을 확인했다. 실제 Google Drive·운영 DB·운영 키·예약·배포 설정에는 접근하지 않았다.
