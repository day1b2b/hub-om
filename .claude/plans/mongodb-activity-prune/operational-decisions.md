**현재 문서 기준으로 운영 전환 실행 조건은 아직 충족되지 않았습니다.** Mongo 이전·무유실·기존 기능/권한/암호화 유지와 독립 A/B 복원 검증은 확정됐지만, 실제 대상·보관처·담당자·전환 시간·최신 쓰기 복구 방식은 미확정입니다. **실백업 검증 증거는 문서상 0건**이며, 실제 백업이 존재하지 않는다고 단정할 근거는 없습니다. [확정 범위와 현재 상태](/Users/ga/workspace/hub-om-mongodb-coach-content/docs/operations/mongodb-backup-cutover-plan.md:5)

**1. 이미 확정된 사항**

- 원본 PG·기존 백업·파일·키를 보존합니다. 임의 삭제·키 교체·원본 암호화 backfill은 하지 않습니다.
- A/B는 각각 완전한 복구 세트여야 합니다. 같은 디스크의 두 폴더나 동일 삭제 권한에 종속된 사본은 독립성 증거가 아닙니다.
- 데이터 보관과 키·복구 비밀의 접근 경계를 분리합니다. 활성 키뿐 아니라 과거 암호화 키와 HMAC 키도 복구 대상입니다.
- 관리자 코치 JSON 다운로드, shadow export/import, 합성 테스트는 전체 DB 백업·운영 복원 증거를 대신하지 않습니다.
- 브라우저 임시저장 암호화는 별도 후속이며 이번 전환의 선행조건이 아닙니다.
- 새 보존기간·기능·암호화 제외 정책을 이번 준비 과정에서 임의로 정하지 않습니다. [복구 세트·독립 보관 기준](/Users/ga/workspace/hub-om-mongodb-coach-content/docs/operations/mongodb-backup-cutover-plan.md:30)

**2. 사용자 결정·외부 조치가 필요한 항목**

아래는 지금 전부 답해야 하는 질문 목록이 아니라, 해당 단계까지 확보해야 할 결정과 증거입니다. 실제 위치·계정·키 값은 공개 대화가 아닌 승인된 비공개 장부에서 관리해야 합니다.

| 항목 | 선택·확정할 내용 / 필요한 정보 | 선행 증거·차단 시점 |
|---|---|---|
| **접근·보존 범위 — D01** | 실제 DB, 모델 밖 객체, 첨부 bytes, 서버 파일, 비공개 adapter, 활성 CLI·예약·관리자 작업 목록. 실행자와 허용 작업 범위 | 데이터·기술 책임자의 목록 확인과 사용자 접근 범위 명시. **실접근·백업 전** |
| **A/B 저장 위치 — D02** | Google Drive를 A 후보, OneDrive를 B 후보로 사용한다. 외장 SSD는 사용하지 않는다. 로컬은 암호화 생성·격리 복원 임시 공간이며 영구 A/B가 아니다. 같은 클러스터·계정의 `hub-om-shadow-validation`과 `hub-om`도 백업 두 개로 세지 않는다. | 각 서비스의 실제 계정·용량·retention·전송/저장 암호화·독립 삭제/복구 권한은 인프라·보안 책임자가 양쪽 별도로 확인한다. **실백업 실행 전** |
| **보존·담당자 — D03** | 기존 승인 retention, 만료·자동 정리 방식, PG·키·파일·변경 이력의 보존 책임자와 대체자 | 복구에 필요한 키나 이력이 데이터보다 먼저 만료되지 않는다는 확인. 기준이 없으면 별도 결정. **백업·전환 전** |
| **키 복구 — D04** | 활성/과거 키·HMAC·백업 암호화 복구 수단의 분리 보관 및 비상 회수 절차 | 운영 메모리·기존 캐시 없이 A/B 각각 복구·암호문 검증. **복원·전환 전** |
| **백업 방식·실규모 — D05** | PG 전체 복원 방식, Mongo 및 파일 백업 방식, 데이터 크기와 복원 공간 | 기존 importer의 파일당 32MiB·모델 파일 합계 128MiB·100만 행 한도 수용 여부. 초과 시 누락 없이 처리할 경로와 실제 복원 증거. **전환 전** |
| **원본 상태 — D06** | PG 평문/암호화/혼합 상태, schema·정책·codec 호환성. 원본 변경 없는 조사 범위 | 승인된 조사와 export·앱 계약 대조. PG backfill은 자동 선행조건이 아님. **실export 전** |
| **최종 복사 방식 — D07** | **우선 준비안:** 쓰기 중단 후 새 전체 스냅샷. **대안:** 초기 복사 후 검증된 증분 반영 | 전체 복사는 중단 시간이 길 수 있음. 증분은 변경·삭제 포착과 재시도 구현이 추가로 필요하며 현재 도구에는 없음. **쓰기 중단 전 확정** |
| **시간·중단 기준 — D08** | 전환 창, 허용 중단/복구 시간, 관찰 기간, 중단 판정자·연락 담당 | 실제 복사·A/B 복원 소요 시간에 근거한 일정. 수치·날짜는 미정. **쓰기 중단 전** |
| **운영 구성 — D09** | Mongo 운영 구조 배치, 전체 앱·health·백업·CLI·예약 연결, writer 중지/재개 방법 | 인덱스·validator·권한·암호화·첨부 검증, PG fallback 및 양쪽 동시 쓰기 없음. **읽기 연결 전환 전** |
| **전환 후 복구 — D10·D11** | **전진 복구 또는 PG 역이관**의 주 경로·대체 경로, 승인자와 단일 writer 재개 기준 | 첫 Mongo 쓰기부터 장애 시점까지 생성·수정·삭제·파일·미확정 요청·외부 처리 상태를 재현한 리허설. 역이관 구현은 현재 도구에 없음. **Mongo 쓰기 개시 전** |
| **실제 A/B 증거 — D12** | 수행자·독립 검증자와 증거 보관처 | 초기 A/B 복원 통과는 초기 복사 전, **최종 시점의 A/B 재검증은 연결 전환 전** 필요. 초기 결과 재사용 불가 |

표의 기준은 문서의 [D01~D12 미결정 목록](/Users/ga/workspace/hub-om-mongodb-coach-content/docs/operations/mongodb-backup-cutover-plan.md:133)입니다. snapshot 회사/과정 문자열의 개인정보 분류와 실제 PG 정렬 계약도 별도 전환 전 검토 사항입니다. 현행 비보호 분류는 제외 승인이 아닙니다. [잔여 보안 검토](/Users/ga/workspace/hub-om-mongodb-coach-content/docs/operations/mongodb-cutover-remaining.md:45)

**3. 실행 단계별로 필요한 증거**

1. **실접근·초기 백업:** 대상·허용 범위·담당자·A/B 수단을 먼저 확정합니다. 아직 실행하지 않은 최종 전환 결과를 이 단계의 선행조건으로 요구하지 않습니다.
2. **초기 복사:** A/B 각각 저장 후 재읽기, checksum/count, 키 복구, 독립 격리 복원, 앱 검증을 통과해야 합니다. 최초 복사 후에도 PG가 서비스 기준입니다.
3. **최종 일치 판정:** 모든 writer와 진행 중 요청을 정산하고, 생성·수정·삭제·관계 해제·첨부·sequence를 재대조합니다. 동일 최종 시점의 A/B 세트를 **각각 다시 복원 검증**해야 하며 이 시간도 중단 예산에 포함됩니다.
4. **Mongo 읽기 연결:** 일반 쓰기는 계속 닫아둔 채 실제 앱·권한·health·첨부·PG fallback 부재를 확인합니다.
5. **Mongo 쓰기 개시·인수:** 최신 쓰기를 잃지 않는 복구 경로가 검증된 뒤 한쪽 writer만 엽니다. 관찰 기간과 복구 지표를 책임자가 확인해야 인수할 수 있습니다. 인수는 원본 삭제 승인이 아닙니다. [단계별 전환 순서](/Users/ga/workspace/hub-om-mongodb-coach-content/docs/operations/mongodb-backup-cutover-plan.md:97)

**4. 기본 PG 유지와 복귀 조건**

- 개발·합성 검증과 초기 shadow 복사 중에는 기본 PG를 유지합니다. 전체 실행 조립과 실제 전환 증거 없이 환경변수만 바꾸는 것은 완료 조건이 아닙니다.
- Mongo 쓰기 전 실패라면 **Mongo 쓰기가 없고 PG가 최신이라는 증거**를 확인한 뒤 승인된 PG 구성으로 재개할 수 있습니다.
- 시험 쓰기를 포함해 Mongo 쓰기가 발생했거나 결과가 불명확하면 단순 PG 재지정은 금지입니다. 최신 상태를 보존하는 전진 복구 또는 검증된 역이관이 필요합니다.
- 무손실 복구를 증명하지 못하거나 허용 시간이 초과되면 미검증 상태로 강행하지 않고 중단을 유지합니다. [중단·복귀 조건](/Users/ga/workspace/hub-om-mongodb-coach-content/docs/operations/mongodb-backup-cutover-plan.md:112)

**5. 공개 배포 설정에서 확인한 사실과 미확인 사항**

- 일반 [Dockerfile](/Users/ga/workspace/hub-om-mongodb-coach-content/Dockerfile:10)은 Prisma 생성·Next standalone 빌드를 수행합니다. 빌드용 합성 PG 주소는 실제 운영 연결 증거가 아닙니다.
- [진입점](/Users/ga/workspace/hub-om-mongodb-coach-content/scripts/docker-entrypoint.sh:4)은 런타임 `RUN_DB_MIGRATIONS=true`이면 앱 시작 전에 Prisma migration을 실행합니다. **현재 운영에서 켜져 있는지는 미확인**이며, 전환 실행자는 의도하지 않은 PG migration이 발생하지 않도록 명시적으로 확인해야 합니다.
- [Mongo shadow Dockerfile](/Users/ga/workspace/hub-om-mongodb-coach-content/Dockerfile.mongodb-shadow:1)은 일회성 export/import 실행기입니다. 생산 앱 서버 구성으로 간주할 수 없습니다.
- [Verify workflow](/Users/ga/workspace/hub-om-mongodb-coach-content/.github/workflows/verify.yml:3)는 dev/main 대상 검사 정의입니다. 실백업·복원·운영 전환이나 실제 브랜치 보호 설정의 증거는 아닙니다.
- Coolify의 실제 배포 branch·자동 배포 연결·환경값·볼륨·예약 작업·복구 설정은 이번 조사에서 확인하지 않았습니다. 문서상 실제 배포 실행자는 저장소 관리자입니다. [배포 환경 규칙](/Users/ga/workspace/hub-om-mongodb-coach-content/docs/operations/database-runbook.md:58)

**6. dev→main과 운영 전환은 별도 판정입니다**

코드 병합에는 검증·관련 책임자 리뷰·명시적 병합 승인이 필요합니다. 그러나 지정 문서와 공개 workflow만으로 **현재 dev→main이 승인됐거나 준비됐다고 판정할 수 없습니다.** 실제 배포 연결도 미확인입니다.

반대로 모든 실백업 결과를 모든 개발 병합의 선행조건으로 확대할 근거도 없습니다. **기본 PG를 유지하는 코드 반영**, **Mongo 운영 연결 변경**, **Mongo 쓰기 개시**를 구분해 승인해야 합니다. 문서는 dev→main 병합 자체가 Mongo 이전 완료를 뜻하지 않는다고 명시합니다. [전환 완료 판단 기준](/Users/ga/workspace/hub-om-mongodb-coach-content/docs/operations/mongodb-cutover-remaining.md:5)

운영 DB 변경·접속 정보 변경·migration·적재는 사용자가 백업 확인과 실행 범위를 명시하기 전에는 진행할 수 없습니다. 이번 조사에서는 파일 변경, 실행, 외부·DB 접근, 실제 env·키 열람을 하지 않았습니다. [DB 쓰기 안전 규칙](/Users/ga/workspace/hub-om-mongodb-coach-content/docs/operations/db-write-safety.md:14)
