# MongoDB 쓰기 저장소 독립 실행 검토

검토 기준: `plan-v2.md`, `validation-v2.md`. 검토자는 제품 코드를 수정하지 않았다. 대상은 Coach write / TeamUser / InstructorNote 저장소와 각 단위·native 테스트, TeamUser 내부 guard이다. 운영 factory/routes 연결과 실제 이전은 범위 밖이다.

## 판정

현재 읽기 검토, 리뷰어 직접 실행한 단위/mock 검사, 총괄이 제공한 실제 엔진 및 전체 검증 결과를 종합하면 **병렬 쓰기 저장소 준비 범위의 코드 검토는 통과**다. 남은 확정 차단 버그는 발견하지 않았다. 운영 통합·전환은 미완료이며 이 판정은 운영 전환 승인이 아니다. V15의 alignment/handoff/gap 문서까지 확인했으며, 이번 범위 V1–V15 검토를 마쳤다.

발견한 InstructorNote 초기화 오류 노출은 구현 담당자가 보완했다. 기존 `open()`은 readiness/hello의 원래 driver 오류를 그대로 반환할 수 있었고, 현재는 `INSTRUCTOR_NOTE_OPEN_FAILED`로 일반화한다. 합성 주소를 포함한 연결 오류가 외부 메시지로 나오지 않는 새 회귀 테스트를 포함해 재실행했다.

## 직접 실행한 증거

다음 세 파일을 Node의 strip-types, experimental-test-module-mocks 및 `scripts/ts-loader.mjs`로 실행했다.

- `src/lib/data/mongoCoachWriteRepository.test.ts`
- `src/lib/data/teamUsers/mongoTeamUserRepository.test.ts`
- `src/lib/data/mongoInstructorNoteRepository.test.ts`

결과: **11 passed / 0 failed / 0 skipped**. 로컬 로그: `/tmp/hub-write-review-tests.log` (임시 파일이므로 영구 증거는 총괄 결과 manifest에 별도 기록). mocked transaction 성공을 실엔진 원자성의 증거로 세지 않았다. Node experimental/module-type 경고가 있었으며 테스트 실패는 없었다.

## 핵심 코드 대조

| 검증 | 판단과 반례 |
| --- | --- |
| V1·V4·V5 Coach 기존 계약 | POST의 employeeId 무시, dxTag 제외, 기본 status/isActive, PUT 생략 필드 보존, 빈값/형식불일치 날짜의 null 정규화, status PATCH의 isActive 유지와 soft delete를 기존 route와 대조했다. 삭제 후 수정은 차단한다. 필수 입력 및 정규화 후 Invalid Date는 실패한다. |
| V2·V8 TeamUser | 이메일 trim/lowercase 비교 전에 같은 transaction에서 guard를 먼저 갱신한다. 신규 저장소 간 competing writer는 재시도 시 새 snapshot으로 roster를 다시 읽는다. 배치 중복 ID는 matched row 수로 세고 누락 ID는 제외한다. 기존 null 이메일 동작을 유지한다. 구 writer는 guard를 따르지 않으므로 운영 연결 전 단일 쓰기 경로가 필수다. |
| V3 InstructorNote | get(name)는 null NO 우선, save(name)는 작은 NO/null-last 우선인 기존 비대칭을 보존한다. saveByNo 생성 시 조회 NO를 사용하고 수정 때 patch NO 변경을 허용한다. 이름은 unique가 아니므로 동시 최초 name 저장의 중복행 가능성은 기존 의미이며 보장 확대를 주장하지 않는다. |
| V6·V10 암호화 | 쓰기 전체 row가 runtime codec을 거친다. 기존 row를 복호화·검증한 후 부분 patch를 병합하므로 변조된 기존 개인정보를 평문 새 값으로 덮어 검증을 건너뛰지 않는다. driver 오류 일반화와 누락 키/변조 실패 검사를 확인했다. |
| V7 원자성 | Coach의 profile/tag/master/audit와 TeamUser 역할 배치, InstructorNote 교체가 session transaction 안에 있다. 재시도마다 이전 상태를 다시 읽는다. 총괄 제공 MongoDB 7.0.43 native 결과에서 아래 기술한 실패 주입·동시 요청 반례가 통과했다. |
| V9 준비·격리 | explicit shadow write gate, validator/index readiness와 replica/session 검사, namespace 분리가 있다. 정상 open에서 setup을 호출하지 않는다. TeamUser guard setup은 별도 명시 함수이며 삭제/누락/MAX guard는 차단한다. |
| V11·V12 실행 증거 | 단위/mock 11개만 직접 실행했다. native 파일은 합성 임시 DB, 명시 loopback URI, 임시 암호화 키, 중첩 finally cleanup을 갖춘다. 총괄의 native 3개 통과 및 전체 type/build/lint 결과를 execution-manifest와 대조했다. 리뷰어가 원격 실행을 직접 수행하거나 원격 로그를 직접 읽은 것은 아니다. |
| V13·V14 운영 경계 | 신규 저장소에 대한 non-test 사용처 검색 결과 운영 호출처가 없다. 생산 factory/routes는 PG이며 actor 객체는 권한 검증의 대체가 아니다. caller 인증/권한/activity, TeamUser 물리삭제 정책과 기존 writer 배제는 전환 전에 해결해야 한다. `mongodb-runtime-coverage.md`에 잔여 경로를 기록했다. |
| V15 | 독립 계획·실행 검토 문서는 작성했다. execution-manifest와 전체 검증 기록을 확인했다. 후속으로 alignment-review/handoff/gap-plan을 확인했다. 이번 저장소 준비 완료와 전체 runtime 전환 in_progress를 구분하며 남은 gate를 보존한다. |

## native 테스트 설계 검토와 한계

Coach는 마지막 audit insert를 실제 validator로 거절한 후 7개 collection 전체를 이전 상태와 비교한다. TeamUser는 배치의 뒤쪽 행 교체 실패를 유도해 먼저 제출된 쓰기와 guard까지 복원됐는지 비교한다. InstructorNote는 실제 unique NO 충돌, validation 실패, 변조 및 키 누락 후 문서 불변을 검사한다. 세 suite 모두 병렬 patch/생성을 실행하고 남은 값 또는 unique 행 수를 검증한다.

Promise.all 기반 경쟁은 실제 동시 요청 회귀이며 모든 가능한 interleaving의 증명은 아니다. 코드의 snapshot transaction 재독해/guard 첫 쓰기와 함께 판단한다. 같은 NO의 bounded duplicate retry는 충돌에서 무한 반복하지 않는다. 총괄의 native 성공은 해당 합성 반례에 대한 실제 엔진 회귀 통과로 인정하며 장시간 부하, 장애 주입 전반 또는 실운영 데이터의 증명으로 확대하지 않는다.

운영 연결 시에는 단순 repository 교체 외에 caller 권한, request activity/기존 PG trigger 효과, direct Prisma 경로, 이전 데이터·복구 검증을 별도 gate로 유지해야 한다. 현재 명시된 병렬 저장소 준비 범위에서는 이러한 미연결이 의도된 제약이다.


## 총괄 제공 실행 증거 (리뷰어 직접 실행과 구분)

`execution-manifest.md` 및 총괄 결과 메시지를 대조했다. 실제 MongoDB 7.0.43 replica set에서 Coach 338.797ms, InstructorNote 256.163209ms, TeamUser 220.844173ms, 총 1413.620209ms로 **3 passed / 0 failed / 0 skipped, exit 0**이다. 원격 로그는 `/tmp/hub-om-shadow-write-w924k7/native-writes.log`이다. 신규 9개 source/test archive SHA256은 `e4167d613560663a47da623ba6c41c3a31ed551364891d7f226a35af39a66a97`이며 총괄이 서버 동일성 확인과 readonly bind 사용을 보고했다. network-none 컨테이너의 loopback, 합성 키/데이터만 사용했고 종료 후 `remainingSyntheticDatabases=0`을 보고했다. 이 리뷰어는 원격 로그 원본을 직접 조회하지 않았다.

전체 로컬 결과는 800 pass / 10 skip / 0 fail, typecheck/build 통과, lint 오류 0·기존 경고 7이다. 전체 테스트의 생략 10개를 native 3개로 임의 차감하거나 합산하지 않는다. 실제 PG 쿼리 대조, 대상 MongoDB 8.0, 운영 데이터 복사/복구, 전체 runtime 연결은 미검증이다.

## validation-v2 최종 판단

| 항목 | 판단 | 근거와 범위 |
| --- | --- | --- |
| V1 | 통과 | Coach unit/native 생성·부분 수정·DTO·암호화 검증. |
| V2 | 통과 | Team 정규화 중복·팀/역할·matched count, 오류 은폐 개선은 계획에 명시. |
| V3 | 통과 | InstructorNote null/NO 우선순위와 생략·빈값 의미 unit 대조, native unique/부분 수정. |
| V4 | 통과 | 삭제/없는 Coach 차단, 없는 Team null, 명시 Note upsert만 생성. |
| V5 | 통과 | 기존 날짜 정규화 유지 및 Invalid Date/필수 입력 실패 unit. |
| V6 | 통과 | codec 저장과 일반화 오류, 새 초기화 오류 노출 반례 통과. |
| V7 | 통과 | 세 native suite의 해당 실패 주입·병렬 부분 수정 반례에 한정. |
| V8 | 통과 | native 정규화 이메일 경쟁 최대 한 행, notionNo 경쟁 한 행 및 충돌 복원. |
| V9 | 통과 | explicit gate/readiness/replica/namespace/guard 차단, 정상 open 쓰기 없음. |
| V10 | 통과 | 기존 암호문 변조·키 누락 실패 및 문서 보존 검사. |
| V11 | 통과 | 전체 테스트·type/build/lint와 생략/기존 경고 기록. |
| V12 | 통과 | 합성 native 결과와 mocked 결과 분리, cleanup 보고. |
| V13 | 통과 | 운영 사용처 미연결 확인, 승인된 shadow guard 외 PG schema/생산 경로 변경 없음. |
| V14 | 통과 | 물리삭제 차단 및 runtime inventory에 잔여 API/auth/activity 경로 명시. |
| V15 | 통과 | 독립 리뷰/manifest/alignment-review/handoff/gap-plan 확인. 다음 provider 경계 작업과 전체 전환 in_progress가 명시됐으며 운영 이전 완료 주장은 없음. |
