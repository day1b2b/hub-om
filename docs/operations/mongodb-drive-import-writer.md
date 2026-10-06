# Drive 가져오기 이력 쓰기 경계

상태: 구현·격리 검증·독립 실행 수락 완료. 원격 통합 상태는 해당 integration-review를 따른다. 운영 적용이나 전체 Mongo 전환 완료 문서가 아니다.

`drive:import:dry-run`의 대상 조회와 이력 쓰기를 repository로 분리한다. 기본 저장소는 암호화 wrapper를 사용하는 PostgreSQL이다. Mongo는 명시적으로 주입한 검증 context에서만 사용한다. 기존 Drive scanner와 원천 권한·설정은 유지한다. 운영 데이터에 후보를 자동 적용하지 않지만 run/result 이력은 쓰므로 명령 이름의 dry-run을 DB 무쓰기라고 해석하면 안 된다.

## 기존 동작

- 삭제되지 않은 운영 건을 시작일·운영 ID로 정렬해 선택한다. 부모 회사/과정의 삭제 여부로 새 필터를 추가하지 않는다.
- Drive 링크, 강의관리 링크, 폴더 검색 순으로 원천 입력을 선택한다. 조회 issues와 실행 오류를 구분한다.
- pending run을 먼저 만들고 결과를 개별 저장한다. 중간 실패 전에 저장된 결과는 남는다. 재실행은 별도 run이며 새 중복 방지 정책을 추가하지 않는다.
- 개별 저장 성공 뒤 통신 오류가 보고되면 성공 결과와 오류 결과가 둘 다 남을 수 있다. 결과 수를 운영 건 수 이하로 제한하지 않는다.
- 원본의 0~1 사이 concurrency 값은 floor 후 worker0이다. 임의로 최소1로 바꾸지 않는다. mode 문자열은 기록이며 실행 중지 옵션이 아니다.
- DATE 출력은 기존 node-pg의 로컬 자정→UTC 날짜 변환 의미를 보존한다. 합성 UTC/Asia-Seoul 검증과 실제 운영 시간대 수락은 별개다.

## 암호화와 실패 처리

기존 privacy 정책과 runtime codec을 따른다. 원천 오류 내용은 암호화된 error 필드에 보존하되 공개 CLI 오류와 저장소 오류는 고정 코드로 제한한다. 허용된 이력 조회의 복호화 값과 저장 상태의 평문 비노출을 구분한다. 회사/과정 snapshot 등 기존 정책의 전체 개인정보 분류 검토는 별도 전환 조건이다.

CLI를 import하는 것만으로 env 파일 조회·DB 연결·원천 호출을 시작하지 않는다. 직접 실행할 때만 기존 .env→.env.local 순서를 유지한다. 명시 context에서는 writer/source가 모두 있어야 하며 누락 시 기본 PG로 대체하지 않는다.

Mongo 준비는 명시 shadow에서 기존 다섯 모델의 metadata와 과거 문서를 먼저 검사한다. 부적합한 namespace를 자동 삭제하거나 validator로 덮어 고치지 않는다. 준비 중 누락 collection만 만들며 모든 기존 collection의 선검증이 끝나기 전에는 DDL을 하지 않는다.

## 한계와 복구

Mongo 대상 조회는 snapshot과 유한 행·바이트·시간 예산을 사용한다. 상한 초과는 실패하며 잘린 대상을 정상 완료하지 않는다. 부모 존재 확인과 append는 짧은 transaction이지만 원천 I/O는 transaction 밖이다. 물리 삭제와 동시에 발생하는 PostgreSQL FK의 CASCADE/SET NULL 동작 전체를 이번 범위에서 보장하지 않는다. 현재 soft-delete 동작은 유지하며 새 삭제 정책은 없다.

Mongo finish는 손상된 기존 notes도 인증하므로 PG updateMany보다 엄격하게 실패할 수 있다. 완료 UPDATE에 해당 run이 없으면 원본처럼 0행 성공하며 upsert하지 않는다. 장애 시 기존 pending/부분 이력을 먼저 확인하고, 임의 삭제·자동 재시도·전체 rollback을 하지 않는다.

실제 Google 원천·운영 DB·키·환경·배포 변경 및 운영 실행은 하지 않았다. 배포 전 전체 전환 조건, 실제 원천 수락, 백업·복원·복사 리허설과 적용 순서를 별도 확인해야 한다. 실행 증거는 `.claude/plans/mongodb-drive-import-writer/`의 최종 실행·인계 기록을 따른다.
