# 로컬 저장 암호화·재시도 통합 인계

2026-09-21 사용자 승인 범위: 통합 차단 항목 2. 브랜치 `fix/20260921-local-storage-integration`.
암호화 기준 `82c208d385b812c773b1d43d14a20209d20b9621`, 기능 원본 `0e2bafe`의 로컬 요청 식별/receipt 부분만 이식했다. 원래 체크아웃과 담당자 브랜치는 변경하지 않았다.

## 현재 결과

로컬 operations와 creationReceipts를 하나의 암호문으로 저장한다. AAD는 기존 `local:operations`이다. 모든 생성·수정·삭제가 receipt를 유지하며, 삭제 이후 동일 요청도 다시 생성하지 않는다. 같은 파일의 인스턴스들은 프로세스 안에서 쓰기 큐를 공유한다.

파일 전체를 암호화한 뒤 동일 디렉터리의 독점 생성 임시파일에 0600으로 쓰고 파일 sync 후 rename한다. 기존0644 파일도 저장 후0600이다. 복호화·검증·암호화 실패 또는 관측한 부분 쓰기/rename 실패에서 기존 bytes를 유지한다. rename 성공 후 오류를 낼 수 있는 정리 작업을 수행하지 않는다.

legacy 배열/operations-only는 기존 `PII_ALLOW_PLAINTEXT_READS` 정책을 따른다. 설정을 켜도 쓰기는 암호화한다. 정상 요청 ID를 가진 기존 행에서 누락된 receipt를 복구하며, 수정·삭제 전에도 복구한다. 범위 ID가 서로 충돌하거나 복수 행으로 재시도 대상이 모호하면 거부한다. 이미 삭제되어 행과 receipt 모두 없는 과거 이력은 복구할 근거가 없다.

## 범위와 한계

- 실제 폼/API에 새 요청 식별자 전달을 연결하지 않았다. 전달받은 identity에 대한 repository 계약의 통합이다.
- 브라우저 초안 암호화와 별도 잠금 방식, OM 배정 감사 계약, MongoDB 전환, 전체 브랜치 통합은 미완료 상태 그대로다.
- 운영 파일/DB/키, 배포, 원격 push/merge는 실행하지 않았다. 모든 fixture는 임시 폴더의 가짜 데이터와 임의 테스트 키다.
- 여러 프로세스 동시 writer, 심볼릭 링크 별칭, 전원 장애 시 디렉터리 fsync까지 포함한 내구성은 보장하지 않는다. 로컬 파일 저장소를 다중 writer 운영 DB 대체로 사용하면 안 된다.
- 권한/개인정보 전체 보호가 완료되었다는 의미가 아니다. 기존 평문 전체를 일괄 변환하지 않는다.

## 검증

Node24.19.0. 기존 잠금파일로 의존성을 설치했고 새 의존성 없음.
대상 24개 통과. 전체 575개 중571통과/4skip/0실패. skip은 격리 PostgreSQL이 필요한 기존 테스트(활동 트리거, 과정명 복원, 캘린더 잠금, PII migration)다.
`npm run lint`: 오류0, 기존 경고7. `npm run typecheck`: 통과. 최종 `npm run build`: 통과.
독립 검토에서 legacy 중복 생성 반례를 발견해 수정한 뒤 재검토 통과.
상세 근거는 [실행 검토](../../.claude/plans/local-storage-integration/execution-review.md) 및 동일 디렉터리 로그.
환경 준비 시 첫 db:generate는 PATH에 npm이 없어 실행되지 않았고, PATH 수정 후 가짜 연결문자열로 클라이언트 생성 성공. 운영 DB 연결 없음.

## 다음 작업을 위한 계약

현재 Initiative: 오류/보안/전체 개인정보 암호화/Mongo 이전. 이번 Task: 로컬 파일 통합. 엄격도 Level3. 상태: 로컬 구현·검증 완료. 근거/인계 준비 완료. 운영 미반영.
읽는 순서: 이 문서 → execution-review → plan-v2/validation-v2 → 필요한 코드.
Do Next: 전체 통합 담당자가 이 브랜치의 로컬 저장 파일·identity helper·타입·테스트를 함께 반영하고 다른 공통파일 충돌을 별도로 검증한다.
Do Not: 기능 브랜치의 평문 JSON writer 또는 암호화 브랜치의 receipt 미보존 writer로 다시 덮어쓰기, 관련 API 계약 없이 프런트 snapshot까지 함께 이식, 운영 데이터 변환/배포를 완료로 간주.
Resume action: start_next_task. 미결정 사용자 제품 선택은 이번 범위에 없음. 다른 통합 항목의 사용자 선택은 기존 대기 상태 유지.
