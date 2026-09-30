# MongoDB 병렬 이전 상위 계획

최신 총괄 상태: 2026-09-30 Notion 통합3c72e69 기준 Drive CLI 이력 writer의 명시 source/저장 경계를 구현·합성 검증했다. 실행·독립리뷰·정리·원격 통합은 ../mongodb-drive-import-writer/ 기록을 따른다. 다음 작은 후보는 health 명시 조회 경계다. 운영 기본PG, 전체 이전 미완료, 실백업증거0, dev→main 조건미충족 상태를 유지한다.

목표: 기존 PostgreSQL 운영을 유지하며 개인정보를 암호화한 별도 MongoDB를 검증한 뒤 안전하게 전환한다.

1. 복사 기반: 35모델 read-only export, 암호화 spool, insert-only import와 참조/고유키 검증. 코드와 합성 검증 완료, 실제 복사 미실행.
2. 런타임 전환: Operation 작성/조회 구현 후 도메인별 repository와 API·배치·권한·감사를 순차 전환. 이번 범위는 Team/Coach 조회 10개. 종료 기준은 모든 사용 경로와 회귀·권한/암호화 검증 완료이며 아직 진행 중이다.
3. 운영 리허설: 실제 source mode 확인, 승인된 shadow 복사, 데이터/화면/성능 동등성, 백업 복원·역동기화/전진 복구. 미실행.
4. 전환: 원본 쓰기 동결, 최종 snapshot/sequence 상한, 데이터 대조, 검토 후 factory·배포 연결. 운영 신규 쓰기 이후 단순 PG 주소 복귀 금지. 미실행.

운영 PG backfill, 전체 환경 복제, 키 변경, 기존 미커밋 파일 변경을 이 조회 작업에 섞지 않는다.

## 2026-09-22 저장소 구현 후속
코치 CRUD·팀 명단 생성/수정·강사노트 저장의 shadow 구현과 Mongo7.0.43 합성검증 완료. 다음 작업 및 남은 gate는 ../mongodb-write-repositories/handoff.md, docs/operations/mongodb-runtime-coverage.md 참고. 전체 runtime/실제복사/전환 Wave는 계속 in_progress.

## 2026-09-22 API 경계 후속
Coach 관리 route·Team facade·Instructor save·요청/개인정보 감사의 명시 Mongo context와 PG 진입 차단 구현. 로컬 Mongo8.0.30 합성 검증 완료. feature 원격 보관 연결 문제 해소. 전체 runtime Wave는 진행 중이며 다음 Task는 코치 토큰/본인/개인정보 export 경계. 최신 증거·gap은 ../mongodb-api-boundaries/handoff.md를 따른다.

## 코치 접근 경계 후속
코치 token/본인조회/export/재발급의 명시Mongo경계와 실제권한/감사검증 완료. 다음 Task는 일정등록/예약/취소. 최신근거 ../mongodb-coach-access/handoff.md. 전체runtime/실제데이터/배포는 진행중.

## 일정·예약 총괄 통합
1601e60의 일정등록/관리조회/예약/본인취소 구현을 총괄feature에 fast-forward 통합하고 전체회귀837pass16skip 재확인했다. 최신검토는 ../mongodb-coach-schedules/integration-review.md. 다음 Task는 engagement 확정/예약자동취소/관련동기화writer의 공통원자성이다. 예약없는시점의확정과신규예약경쟁을 공통guard/재검사로검증하며 기존삭제·확정이력정책을임의로바꾸지않는다. 전체운영이전은진행중.

## 섭외·자동취소 총괄 통합
71ed7d8을 총괄feature에 fast-forward하여 전체848pass17skip 재확인, 별도독립통합검토통과. 최신근거 ../mongodb-coach-engagements/integration-review.md. 다음은 contractSheetSync/samsungScheduleSync의 원천adapter·실제저장경계와 공통guard, 다중코치잠금순서·기존Cascade/SetNull 계약 검증. 전체운영이전은계속진행중.

## 시트 동기화 총괄 통합
47b9ba6을 통합하여 전체864pass18skip0fail 재확인, 독립 통합 검토 통과. 근거는 ../mongodb-coach-sheet-sync/integration-review.md. 다음은 Notion 코치 sync 저장 경계와 catalog 잠금 참여, 실제 sync/all 합성 검증이다. 그 직후 이름을 포함하는 sourceEngagementId/sourceEngagementScheduleId 평문 저장을 암호화 정책·고유키·조회·snapshot/runtime·이전 도구까지 함께 보완한다. 해당 평문은 전체 암호화/운영 전환 차단 항목이며 허용된 제외 범위가 아니다. 이후 runtime-coverage의 미전환 기능을 계속 진행한다.

## Notion 코치 동기화 후속

명시 source/repository와 PG 기본/Mongo adapter, 실제 Notion/all 및 catalog 참여를 구현·검증했다. 일반876pass19skip0fail, Mongo8.0.30 묶음110pass0skip(mock4포함), type/buildpass, lint0error기존7warning. 실행·독립 검증 근거는 ../mongodb-coach-notion-sync/execution-review.md를 따른다. 다음 작업은 이름 포함 sourceEngagementId/sourceEngagementScheduleId의 암호화 정책·검색/고유키·snapshot/runtime·기존변환 보완이며 전체 개인정보 암호화의 필수 차단 항목이다. 이후 남은 runtime 경로·실제복사/복원/전환을 계속 수행한다.

## 원천 식별자 암호화 후속

feature/20260922-source-identifiers-encryption에서 이름 포함 sourceEngagementId/sourceEngagementScheduleId를 암호화 정책·HMAC unique·PG migration·계약 snapshot·Mongo 시트 HMAC 매칭·기존 namespace 거부까지 구현했다. 격리 PG17과 Mongo8.0.30 replica set으로 전환 상태·부분 중단·재시도·키 불일치·재동기화를 검증했다. 근거는 ../mongodb-source-identifiers-encryption/execution-review.md. 운영 migration/backfill은 미실행이다. 다음은 총괄 feature 통합 검토 후 runtime-coverage의 미전환 기능과 실제 복사·복원 리허설이다.

## 원천 식별자 암호화 총괄 통합

b032fc5를 총괄 feature에 fast-forward하고 전체 회귀(일반876pass20skip0fail, Mongo112pass, PG22pass, type/build/lint)를 재확인했다. 근거는 ../mongodb-source-identifiers-encryption/integration-review.md. 다음은 runtime-coverage의 미전환 기능 전환과 운영 backfill·실제 복사·복원 리허설 준비다. 전체 운영 이전은 진행 중이다.

## 코치 태그 마스터·삭제 코치 관리

feature/20260923-mongodb-coach-master-restore에서 태그 마스터·삭제 코치 목록/복원/영구삭제의 Mongo 경계를 구현했다. 영구삭제는 결정권자 결정으로 기존 물리 삭제와 동일하게 유지한다. 근거는 ../mongodb-coach-admin/execution-review.md. 다음은 코치 메모·콘텐츠·관리 조회 등 남은 coverage 기능군이다.

## 코치 메모·콘텐츠·관리 조회 후속 (2026-09-29)

feature/20260929-mongodb-coach-content에서 메모 CRUD/피드/월 등록현황·status/관리페이지 삭제수를 명시 repository 경계로 연결한다. 이전 9/23 임시 작업과 리뷰 stall 결과를 재사용하지 않고 e1b9749부터 재구현했다. 실제 PG/Mongo 대조로 다중 묶음 cursor 오류와 콘텐츠 감사 표현 차이를 발견·보완했다. 최신 검증·독립 리뷰·원격 인계 상태는 ../mongodb-coach-content/execution-review.md와 handoff.md를 따른다. 총괄 통합은 별도이며 생산 기본은 PG다. 나머지 coverage 기능·실제복사·복구리허설·운영전환·브라우저초안 암호화는 미완료다.

## 담당자 내 페이지 후속 (2026-09-29)

bc77a12에서 기존 활성 예약·확정 과정 조회를 PG 기본 adapter와 명시 Mongo context로 분리했다. 이메일 exact/HMAC 확인, 취소여부와 무관한 확정 링크·예약 coach 우선, 기존 이름 매칭·그룹·기간·슬롯·삭제 coach 포함을 보존한다. Mongo 한 메서드 안의 명단과 관계를 같은 snapshot으로 읽는다. 실제 PG45 migration·독립 DTO와 Mongo 비교 및 실제 page/admin guard 경계를 검증한다. 최종 결과는 ../mongodb-manager-my-page/execution-review.md. 다음 기능 후보는 coachAccessTokenBackfill이며 쓰기·키·재실행 계약을 별도 계획으로 검토한다. token backfill, 다른 coverage 기능 및 운영 이전은 이번 단위에 포함하지 않았다. 전체 미완료이므로 dev→main 병합 조건도 아직 충족되지 않았다.

## 코치 접근 토큰 보완 후속 (2026-09-29)

1a7323b 기반으로 기존 PG 직접주입함수를 보존하고 CLI→service→repository 및 명시 coachTokenBackfill context를 연결했다. 최신 non-null 보관 토큰 선택, 250건 페이지, HMAC·암호문, dryrun 불변/apply 전체취소·재실행0을 실제 PG45migration과 Mongo로 대조했다. 실행·실패보완·독립리뷰·인계는 ../mongodb-coach-token-backfill/ 문서를 따른다. 운영에 backfill을 적용한 것은 아니다. 다음은 coverage의 남은 코치 legacy 경로 사용처 점검과 운영·과정 관리자 기능을 작은 단위로 전환하는 것이다. 전체 운영 이전과 dev→main 완료 조건은 아직 충족되지 않았다.

## 관리자 과정 조회·소프트 삭제 후속 (2026-09-29)

d964cb2 기준에서 코치 legacy 이력의 실제 사용처를 확인했다. logProfileEdit는 기존PG adapter 내부이며 Mongo 프로필/평가 이력은 이미 구현되어 있다. 호출처 없는 logReviewEdit를 새 미전환 기능으로 중복 구현하지 않았다.

다음 실제 경계인 admin/courses lookup과 과정 내 활성 운영 건 soft-delete를 별도 courseAdmin repository로 분리했다. 기본PG 쿼리·권한·DTO·재실행0·관계보존을 유지하며 명시Mongo context에서 snapshot·암호화한 삭제자/HMAC·원자적 감사·기존writer 충돌재시도를 검증한다. 새 삭제정책/스키마/운영selector 변경없음. 증거·최종리뷰·통합상태는 ../mongodb-course-admin/ 문서 참조. 다음후보는 삭제 운영 목록/복원 등 남은 운영 관리자 기능이다. 가져오기·Calendar·공지·전체실데이터이전·복원리허설·운영전환은 미완료로 유지하며 dev→main 완료조건은 아직 충족되지 않았다.

## 삭제 운영 목록·복원 후속 (2026-09-29)

b401626 기반에서 deleted-operations GET/PUT를 별도 repository와 명시 deletedOperations context로 연결했다. PG 기본·8필드·exact문자열ID·삭제/활성/반복복원의updatedAt갱신·감사제외를 보존한다. Mongo snapshot관계조회와 삭제자/HMAC초기화·부분쓰기·원자적감사, 기존일반/과정삭제writer와경합을 실제PG원본query oracle 및합성Mongo로검증한다. 실행·독립리뷰·통합상태는 ../mongodb-deleted-operations/ 문서. 운영DB나원천에복원을실행한것은아니다.

후속작은개발단위후보는 기존관리자 onsite-required-backfill 및 om-assignment-status-backfill의 count/apply 경계다. 두기능의기존버튼/조건/응답과명확한업무필드를유지하고 실제운영보정은수행하지않는다. 운영이전/복구리허설/생산backend선택/dev→main은미완료.

## 관리자 현장 투입·OM 배정 상태 보정 후속 (2026-09-29)

118e276에서 두 관리자 보정 GET/POST를 operationBackfill 경계로 분리한다. 기존 Y/ASSIGNMENT_PLANNED 목표·exact placeholder 조건·대상0/재실행·권한·응답을 유지한다. HMAC 후보 검증·부분 갱신·transaction 감사·기존 writer 경합을 실제합성 PG 원본query oracle 및 Mongo로 검증한다. 실행/독립리뷰/인계는 ../mongodb-operation-backfill/을 따른다. 기존 onsite CLI·관리자 DB 호스트/셀·과정명 복원 등 다른 기능과 실제 운영 보정은 별도다. 실데이터 이전·복구리허설·운영전환 및 dev→main 완료조건은 아직 충족하지 않았다.

## 과정명 복원 미리보기·선택 적용 (2026-09-29)

95cdb6f에서 courseNameRestore를 PG기본 adapter와 명시Mongo 경계로 분리했다. 기존 근거 차단/metadata/지문/1~100선택 계약을 유지하고 내부singleton guard로 복원끼리의 disjoint 쓰기 경쟁을 처리한다. guard는 업무모델·PG스키마가 아닌 coordination 컬렉션이며 counter를 더미 잠금으로 사용하지 않는다. 일반893pass/42skip·전체Mongo360pass/0skip(mock4포함)·실PG대조/SSI8pass·handler/factory8pass·typecheck/build·lint0error/기존7warning을 확인했다. 중복 묶음은 합산하지 않는다. 검증·리뷰·통합은 ../mongodb-course-name-restore/에 기록한다. 다음 작은 후보는 관리자 DB 호스트/셀 편집이며 별도 계획으로 계약을 확인한다. 운영복원과 전체앱전환·실데이터이전·복구리허설·dev→main은 미완료다.

## 관리자 DB 조회·셀 편집 후속 (2026-09-29)

4db4cf6 기반에서 기존 8표 표시와4표편집·페이지담당자목록을 adminDatabase/teamMembers 명시경계로 연결한다. 새업무필드·권한·삭제정책없이 PGquery/formatter/parser원본독립oracle로 검증한다. 소유PG56659/Mongo27759만사용하며 실제운영수정은없다. 계획/검증/실행/독립리뷰는 ../mongodb-admin-database/를따른다. 구현·합성검증·독립 V1–V10 수락 완료. 일반895pass45skip/Mongo402pass0skip(mock4포함), 추가native43/handler12/PG5는중복합산하지않는다. type/build PASS, lint기존7warning. 원격통합은integration-review를따른다. 전체운영전환/dev→main은별도미완료다.

## 공지·첨부 후속 (2026-09-29)

5f9d291에서 공지6handler/3조회page의직접PG를 announcements repository로분리한다. 기존관리자·HTML정제·응답·공지softdelete/수정중첨부제거·사전조회/상한계산한계를보존한다. 최대5x5MiB의암호화bytes저장/다운로드·PG감사/nullable·원자성/실경합을독립oracle로검증한다. 실행/독립리뷰/한계/인계는 ../mongodb-announcements/. 구현·합성 검증·독립 V1–V11 수락 완료. 일반898pass48skip/Mongo457pass0skip(mock4포함), PG6/native30/handler13은 중복 합산하지 않는다. typecheck/build PASS, lint 기존7warning. 소유 합성 자원 정리 완료, 원격 통합은 integration-review를 따른다. 운영 전환/dev→main 완료와 구분한다. 다음 후보는 활동 조회·피드·사용 통계 세 GET이며 별도 계획에서 확정한다.

전체 서비스 이전의 선행 관계와 외부 실행 조건은 `docs/operations/mongodb-cutover-remaining.md`에 정리했다. 이미 완료된 기능 경계를 반복 구현하지 않으며 전체 앱 연결·실제 복사/복원/전환은 별도 미완료다.

## 활동 관리 조회·피드·사용 통계 (2026-09-29)

39c70e2에서 세 GET의 기본 PG·명시 activityReads 경계를 분리한다. private 부분검색/공개 LIKE·원문 HMAC users, legacy와 현재 대상 이름/기록 당시 fallback을 원본 PG oracle로 대조한다. 8초 전체 기한/scan별 fullrow32MiB20k의 Mongo 추가 안전제약을 명시한다. `.claude/plans/mongodb-activity-reads/`의 계획·검증·실행·리뷰·인계 기준이며 실제 운영 전환 완료를 의미하지 않는다.

활동 조회 구현·합성 검증·독립 V1–V8 수락과 소유 자원 정리 완료. 일반901pass51skip/전체Mongo497pass0skip(mock4포함), PG6/native30/handler10은 중복 합산하지 않는다. typecheck/build PASS, lint기존7warning. 원격 통합은 해당 integration-review 기준. 다음 후보는 강사 Notion 동기화의 저장/합성 원천 경계이며 실제 Notion·운영 쓰기는 수행하지 않는다.

## 강사 Notion 동기화 (2026-09-29)

3dfa025 기준 feature/20260929-mongodb-instructor-notion-sync에서 저장/원천 경계를 분리한다. 기존 NO/legacy 매칭·수동 입력·행별 부분 성공을 유지하고 기존 Mongo 강사 위키 transaction으로 경합/암호화/감사를 검증한다. 생산 기본 PG, 실제 Notion 접근 없음. 구현·실행검증·독립V1–V3수락·소유자원정리완료. 일반905pass54skip/전체Mongo532pass0skip(mock4포함),PG5/native25/handler10은중복합산하지않는다. type/buildPASS,lint전체0error8warning후새testwarning을제거하고해당파일lintPASS(기존7warning잔존). 계획·실행근거는 ../mongodb-instructor-notion-sync/,원격통합은해당integration-review. 다음후보는매출동기화저장/합성원천경계. 소수 NO의 원본 PG 절단 동작은 실제 PG17.9로 확인했다. 전체 runtime/실제 복사·복원·최종 전환은 별도 미완료다.

## 매출 동기화 (2026-09-29)

a52f191 기준 feature/20260929-mongodb-sales-revenue-sync에서 기존 workflow를 원천/저장/알림 port로 분리하고 기본PG를 유지했다. 명시Mongo의 일괄업무/변경감사·별도요약로그, Decimal/원천 중복/partial/재실행을 실제 원본PG와 대조한다. 계획/실행/검증공백보완/독립수락/원격통합 상태는 ../mongodb-sales-revenue-sync/. 다음 후보는 OM 접수·배정. 전체runtime/생산구성/실제복사·복원·최종전환/dev→main은 미완료다.

매출 실행 검증: 일반910pass57skip, 전체Mongo577pass0skip(mock4포함), 원본PG/newPG/Mongo각135phase의PG5pass. type/buildPASS,lint기존7warning. 개별native28/handler17/source4는중복합산하지않는다. 제품변경없이최종리뷰의T15 test만추가검증했으며정리/원격통합증거는해당handoff를따른다.

매출 제품4ff3234의독립수락·feature원격일치·총괄fast-forward/push확인,소유합성자원정리완료. 후속문서HEAD와최종인계는 ../mongodb-sales-revenue-sync/integration-review.md. 다음OM접수·배정단위로진행가능하며운영전환완료는아니다.

## OM 요청 첫 단위 (2026-09-29)

383d804 기준 feature/20260929-mongodb-om-requests. 독립조사·계획검토에 따라 접수→회차연결/조회/수정/삭제를 첫Task로구분. 기본PG/local유지,명시Mongo감사원자성과합성부수작업포트,actualpage/API검증. 기존접수부분성공/재제출/물리삭제정책그대로. 배정전체는후속필수Task이며현재Mongo문맥에서명시거부. 구현/실행/통합상태는 ../mongodb-om-requests/ 실행·인계문서기준. 전체앱/운영이전/dev→main은미완료.

OM 요청 첫단위 제품908175b 독립수락·총괄FF/push 및 양쪽원격SHA일치,합성정리완료. 인계 ../mongodb-om-requests/handoff.md. 다음Task는OM전체배정이며전체운영전환/dev→main은아직미완료.

## OM 전체 배정 후속 (2026-09-30)

74e1970 기준 feature/20260929-mongodb-om-assignment에서 확인 후 전체 회차 배정·변경·취소 경계를 구현했다. 생성 감사의 exact 집합·기존 서명/권한/수동값 교체를 보존하고 기존 과정명 복원 guard로 역의존 경쟁을 보호한다. 생산 기본 PG 유지, 새 업무 schema/삭제 정책 없음. 중단 전 임시 로그가 없어 새 격리 PG17.9/Mongo8.0.30로 재검증했다. 일반917/64skip, 전체Mongo684/0skip, PG56, native보완25/handler보완20/UI5 통과(중복 합산 금지). 독립 검토의3개 P2 검증 공백을 보완했고 원격 통합은 해당 integration-review 기준이다. 실제 상태는 ../mongodb-om-assignment/handoff.md 및 execution-review.md 기준이다. 가져오기·Calendar 저장/잠금·백업/health·생산 연결·실데이터 복사/복원/최종 전환은 별도이고 dev→main 조건은 아직 충족하지 않았다.

### 공동 개발 통합 우선순위
원격dev307f52f에는 총괄74e1970에 없는4커밋/실질2변경이 있다. OM 배정 단위의 의미 있는 커밋 뒤 일반 merge로 반영한다. 대상은 회차 강사평균 기록(75985a6)과 Calendar 누락 복구(a5592e2)의 새getOperationCreatedAt 계약이다. Mongo/기존PG/local/wrapper·만족도 경로의 의미를 함께 점검하며 main/dev 직접 변경·force push 금지. 이후 각 수직 단위 시작과 총괄 통합 전에 최신dev 차이/겹치는 파일을 확인한다. 다음 새 기능은 이 통합 검증 이후 coverage/cutover-remaining에서 고른다.

## 최신 dev 정합 및 전환 범위 확정 (2026-09-30)

`dc39e19` 기준 `feature/20260930-mongodb-dev-alignment`에서 최신 dev307f52f를 일반 병합한다. 만족도 강사평균과 Calendar 누락 복구의 상대 변경을 보존하고 Mongo 생성시각 조회를 보완했다. 상세 실행·최종 독립 수락·원격 통합 상태는 `../mongodb-dev-alignment/`을 따른다. 전체 앱의 Mongo 선택은 아직 완료되지 않았으며 생산 기본 PG를 유지한다.

사용자 확정 범위는 Mongo 이전과 현재 기능·기존 권한·개인정보 암호화 유지, 데이터 무유실이다. 브라우저 임시저장 암호화는 후속으로 남기되 이번 이전의 선행조건에서 제외한다. 사용 불명확한 CLI/예약 작업을 임의 제외하지 않는다. 실제 A/B 독립 백업 각각의 무결성·키 복구·격리 복원·앱 검증, 원본 PG 보존, 최종 변경/삭제 대조와 Mongo 쓰기 이후 무손실 복귀가 필수다. 구체적 준비/미결정은 `docs/operations/mongodb-backup-cutover-plan.md`에 있고 실백업 확인 증거는 0건이다. 운영 접근/전환 및 dev→main 조건은 아직 충족하지 않았다.


## 2026-09-30 파일 가져오기 임시 저장·검토

총괄8e19638 기준 `feature/20260930-mongodb-import-staging`에서 upload→staging→목록/상세의 명시 imports 경계를 구현했다. 기본PG·parser·권한·기존중복/오류행/동시업로드 의미를 유지하고 비정형 업로드 오류를 고정문구로 가렸다. 원본PG/currentPG/Mongo 대조18, 일반921/68skip, typecheck/build 통과, lint0/기존7warning. 전체Mongo는첫689pass/2fail/1cancel후실패3묶음103pass로보완해파일별최종중복제거751성공을확인했다. 첫실패는기존고정합성주소2건과coachContent전체timeout1건이며검사조건을완화하지않았다. 상세·독립수락·정리·원격통합은 `../mongodb-import-staging/` 기록을 따른다.

다음수직단위는운영승격이다. 기업/과정/운영/source link의transaction, 기존삭제복원/중복, sequence·감사, commit후Calendar를보존한다. 실제Sheets/Notion·Drive기록·Calendar저장잠금·활동쓰기/보존·backup/health·전체앱구성 및 실제이중백업/복원/최종전환은남아있다. 운영기본PG와실백업증거0상태는변하지않았다.

## 2026-09-30 가져오기 운영 반영

75125c9 기준 feature/20260930-mongodb-import-promotion에서 기본PG를 유지한 반영 core/PGadapter/Mongo transaction과 실제 POST의 명시 저장·명단·Calendar 경계를 구현했다. 원본 fixture와 실제 PG 허용 동시 일정으로 전체 값/참조/감사를 대조했고 제한된 자연키 재시도, ordinary 생성 감사의 빈 값 필드, 필수 부모 없는 source 거부를 보완했다. 기존 권한·삭제·차단행·재실행과 commit 이후 실패 의미를 유지했다.

일반922pass/71skip, PG54pass/0skip, Mongo파일별최종833(저장60/API22포함), type/build통과·lint기존7. 첫전체wrapper실패와 파일별결과교체를 명시하고 독립 코드/회귀수락·소유합성정리를 마쳤다. 원격 통합은 ../mongodb-import-promotion/integration-review.md 기준이다.

다음별도Task는Calendar 저장/lease와 실제backfill 연결이다. 원본PG도잠금상실후부분쓰기/Google성공가능하므로새exactly-once를요구하지않고기존실패의미를검증한다. 실제원천/Drive/활동쓰기보존/backuphealth/CLI/전체앱조립 및 실A/B백업복원최종전환은 별도미완료. dev→main 조건은아직충족하지않았다.

가져오기 반영 제품 `504782b9f69a921df7b6ec1422dcf103514494e7`를 작업 branch와 총괄 branch에 atomic push했고 원격 SHA 일치를 확인했다. 원본 workspace·main/dev·운영 설정은 그대로다. 다음은 별도 Calendar 저장·잠금 경계 Task다.

## 2026-09-30 Calendar 명시 경계 수락

8238647에서 별도 작업 branch를 만들었다. 명시8port runtime, CalendarEventLink 저장/시각 port, 서버시간 lease와 mapping+감사 transaction, 전송 전후 소유권 확인, Calendar 실패/로그의 민감 정보 비노출을 구현했다. 일반954/77skip·원본PG5/0skip·전체Mongo963/0skip 및 단언강화adjacent12(부분집합), type/build·lint기존7을 확인하고 독립 리뷰 지적을 닫았다. 제품 hash 동일·소유 합성 정리 완료, 커밋/원격 통합은 integration-review 기준이다. 세부 실패와 한계는 ../mongodb-calendar-boundary/execution-review.md를 따른다. 다음Drive이력조회는원천/CLI쓰기와분리해진행하며전체앱연결·실Google·실제데이터이전완료로해석하지않는다.

## 2026-09-30 Drive 이력 조회

73a137a 기준 별도 feature/20260930-mongodb-drive-import-history에서 저장 이력 조회2개와 기존page의 명시 경계를 검증했다. 기본PG 유지, read-only snapshot/부모/codec/raw오류/budget 및 실제원본PG·SSR 대조. 일반957/83skip, native79/0skip, page7/8/8, PG gate1/parity1, Calendar24/0skip, type/buildPASS·lint기존7. 중복합산 금지, 전체Mongo 재실행 아님. 정리완료, 독립정합/원격통합은 ../mongodb-drive-import-history/ 기록 기준. 다음은Sheets tabs/import 합성원천→기존staging 계획. CLIwriter·snapshot민감문자열분류·운영collation·전체조립·실백업복원전환/dev→main은 미완료.

## 2026-09-30 Sheets 가져오기

feature/20260930-mongodb-google-sheets-import에서 기존 두POST·source/context4파일을 연결했다. 기본PG/HTTP·parser/staging·기존권한·UI/OAuth유지, 누락scope원천전차단과 raw오류비노출은 의도적보완. 원본80파일/7음성대조, 실제3backend ledger45/45/45, 같은입력중복2schedule, actualhandler/auth/audit/암호화/native실패검증. 일반971/86skip, HTTP/handler30 및 최종handler16, transaction16, Calendar24, gate1/parity1, type/build통과·lint기존7. 묶음중복합산/전체Mongo재실행 주장은 금지한다. 실패·최종소스·정리·독립수락·원격통합은 ../mongodb-google-sheets-import/ 기록을 따른다.

Notion 가져오기, Drive CLI writer, CLI/예약작업·전체앱연결·backup/health, snapshot 민감문자열분류·운영collation, 실백업/복원/복사/전환은 별도미완료다. 사용자 인계의 자동화PAUSED를 유지하며 자동재개하지 않았다.

## 2026-09-30 Notion 가져오기

제품 source/context/route3파일, 원본reader·서버token·기존staging·권한·기본PG 보존. HTTP46/handler15/native17/wholeparity각47/일반1017·89skip 및 type/build/lint 검증, 독립지적3건 해소·소유자원정리. 중복합산금지, 원격통합은 ../mongodb-notion-import/integration-review.md를 따른다.

Drive CLI writer·CLI/예약작업·전체앱조립·backup/health·snapshot개인정보분류·운영collation·실A/B백업복원복사전환이 남았다. 자동화재개·운영접근·main/dev변경0. 브라우저 임시저장 보호는 기존 후속범위로 유지한다.

## 2026-09-30 Drive CLI 이력 쓰기

제품8파일. 기존 source scanner/업무 의미를 유지하면서 encrypted PG 기본·명시 Mongo로 연결했다. 원본 PG gate1, scope11/CLI6(일반에 포함), 실제 HTTP/native/reader12, native45, 최종 parity1(3backend×2TZ별22)·일반1034/93skip, type/build/lint를 검증했다. 실패와 독립 지적은 보완하고 소유 합성 PG3DB/Mongo의 잔존0·서버/포트/dbpath 정리를 확인했다. 실행 증거와 최종 원격통합 SHA는 ../mongodb-drive-import-writer/ 기록을 따른다.

다음은 health 명시 조회 경계다. 백업·활성CLI/예약/배포 경로와 전체앱조립, snapshot 개인정보분류·운영collation/TZ, 실A/B백업복원복사전환은 미완료다. 새 삭제/중복/원천권한 정책은 도입하지 않았으며 자동화PAUSED 인계를 자동재개하지 않는다.

## 2026-09-30 Health 연결 경계

health 연결 경계 구현·검증 완료. 기본PG SELECT1과 production HTTP200/503·응답 유지. 명시 databaseHealth만 Mongo borrowed client의 ping1/5초 CSOT를 사용한다. scope 누락은 fallback하지 않는다. 모든 환경의 공개 실패를 고정해 개발 오류 원문 노출을 제거한다. 빈/미생성 DB ping 성공과 유효 형식 다른 키 통과는 연결 확인의 정상 의미이며 readiness를 보증하지 않는다.

일반1045PASS/95 opt-in skip/0FAIL(health scope root+10개는 부분집합), actualMongo9PASS/0skip(root+8), originalPG gate1PASS/0skip(6사례×원본/current 12관찰), typecheck-final/build PASS, lint 오류0·기존경고7. 서로 다른 단위를 합산하지 않는다. 전체 역사 Mongo 묶음을 새로 실행한 것은 아니다. 빌드 후 제품6파일 hash 동일, 기존 정책·의존9파일 baseline 동일. 마지막 worker 변경은 this:pg.Client 타입 표기뿐이며 이후 typecheck-final 통과. 실행·실패보완·독립리뷰·통합 근거는 `.claude/plans/mongodb-health-boundary/`를 따른다.

다음은 관리자 백업 경계다. 전체 Next 서버·실배포·실원천/운영 데이터 검증은 미실행이다. schema/decryption/replica 쓰기/readiness/백업복구/cutover를 검증하지 않는다. 관리자 백업·활성CLI/예약/전체앱 조립·snapshot민감문자열분류·운영collation/TZ·실A/B백업/복원/복사/전환은 별도 미완료다. 브라우저 임시저장 보호는 기존 후속범위다. 기본PG·실백업증거0·dev→main 조건 미충족·자동화PAUSED를 유지한다.

## 2026-09-30 관리자 백업 경계

관리자 backup POST를 기본PG/명시adminBackup repository로 분리했다. 기존 secret 또는 실제 PII admin guard, withActivity, 파일명·headers·exportedAt/counts/data와11개모델전체행·보관metadata6필드최근20개를 유지한다. 승인 응답의 복호화 개인정보와 저장상태 암호화를 구분하며 Mongo companion은최상위에서만제거해사용자JSON키를보존한다. Mongo단일snapshot·누적2만행/32MiB/60초는명시검증범위의보호한계이며초과시전체reject한다. PG에새한도는없다. 저장소실패는cause없는ADMIN_BACKUP_READ_FAILED이며인증오류/withActivity500감사는기존제어흐름을유지한다.

일반1061PASS/97 opt-in skip/0FAIL, scope16PASS(일반의부분집합), 실제Mongo15PASS/0skip(root+14), 실제PG frozen original/current ×UTC/Asia-Seoul 각11사례=44관찰/root1PASS/0skip. typecheck-final/build-final PASS, lint-final 오류0/기존경고7. 중복합산하지않는다. 전체과거Mongo묶음을새로돌린것은아니며변경없는privacy/auth/activity/codec/schema/package/loader15파일hash로기존검증을재사용한다. 일반검사후변경은PG opt-in runner경고허용목록과digest2파일뿐이며actualPG·최종type/lint로재검증했다. 근거는 `.claude/plans/mongodb-admin-backup/`를따른다.

다음은activity:prune CLI의명시저장소경계다. 이 API는기존코치JSON다운로드이며전체35모델/원천archive row/복구이미지를제공하지않는다. 실제Next서버오류페이지·운영데이터·실원천·운영collation·실제A/B백업/각복원/복사/최종전환은미검증이다. Mongo snapshot은원본PG Promise.all에없던일관성보완이며원본과같은동시결과로주장하지않는다. driver read15초+제한된cleanup 검증을HTTP응답전체15초보장으로해석하지않는다. 기본PG·실백업증거0·dev→main조건미충족·자동화PAUSED를유지한다. 전체앱/활성CLI/예약/배포구성·snapshot개인정보분류·운영collation/TZ·운영이전은별도잔여범위다.


## 2026-09-30 활동 기록 정리 경계

activity:prune CLI를 기본 PG와 명시 activityPrune repository로 분리했다. PG SQL·10초 트랜잭션·30/365일·모델별1000개·합계 출력 후 종료 순서를 유지한다. Mongo는 트랜잭션마다 서버 시각을 한 번 읽고 두 삭제를 원자적으로 수행한다. 기존 API 자동 정리도 같은 helper로 연결했으며 전체4초/개별1500ms·시간당 한 배치·best-effort를 보존했다. 생산 기본은 PG다.

일반1082 PASS/99 opt-in skip, command21 PASS(일반 부분집합), 실제Mongo12 PASS, 인접API12 PASS, frozen original/current 실제PG root1 PASS/36worker 관찰. 최종type/build/lint 통과(기존경고7). 중복 합산과 전체 역사Mongo 재실행 주장은 하지 않는다. 독립 getMore P1/출력검증 P2를 보완했고 최종 실행 증거를 수락받았다. 합성 자원 정리와 실패·한계·원격 통합 근거는 `.claude/plans/mongodb-activity-prune/`를 따른다.

이번 단위 종료 후 새 기능은 시작하지 않고 운영 전 필요한 결정·외부 조치를 같은 폴더 operational-decisions.md에 정리했다. 코치 공개 조회 scope 연결, 전체 앱·활성CLI/예약/배포 조립, snapshot 개인정보 분류·운영collation/TZ 및 실제 A/B 백업·각 복원·복사·최종 전환이 남아 있다. main/dev·운영 설정은 변경하지 않았고 자동화PAUSED 인계를 유지한다.

## 2026-09-30 코치 공개 페이지 명시 경계

총괄 be36569 기준 `DataRepositories.coach`와 공개 coach factory의 override-first 경계를 추가했다. 기본 `DATABASE_URL`/Prisma 선택은 유지하고, 명시 scope 누락은 PG fallback 없이 실패한다. 코치 목록·상세·일정·투입, 강사 위키 목록·상세, 운영 상세 7개 실제 page와 실제 auth guard를 native Mongo로 실행했다. UI leaf와 비-coach/외부 IO만 합성했다.

actual page/factory 12 PASS/0skip, 기존 native coach 저장소1 PASS, 일반1083/100skip/0fail, typecheck/build PASS, lint0error/기존7warning이다. 동시 namespace 혼합·조회 중 write·PG/외부 접근·저장 fixture 평문은 모두0이었다. 세부 실행·독립리뷰·정리·원격 통합은 `../mongodb-coach-public-pages/` 기록을 따른다. Google Drive A·OneDrive B는 후보이며 실제 백업/각 복원 증거는0이다. 전체 앱·활성CLI/예약/배포 조립, snapshot 개인정보 분류, 운영 collation/TZ, 실제 복사·복원·최종 전환과 dev→main은 미완료다.

## Drive 결과 snapshot 개인정보 보완 (2026-09-30)

`feature/20260930-mongodb-snapshot-privacy`에서 `DriveImportResult.companyName/courseName`을 암호화하고 non-unique HMAC companion, PG migration, `C` byte 정렬 정책, Mongo 계약·validator/index와 35모델 codec에 반영했다. 합성 PG는 legacy/schema전 실패/혼재·backfill·재실행·partial·키불일치 apply 거부·exact/duplicate/음수 limit/enforce를, Mongo는 79개 history/runtime 시나리오로 암호문·HMAC·정렬·이전정책 평문 문서 거부를 확인했다. 일반1084/101skip, 관련 codec/export/import65, type/build 통과, lint기존7이다. 상세 실행·독립 리뷰·정리·원격 통합은 `../mongodb-snapshot-privacy/`를 따른다.

운영 migration/backfill/enforce·기존 namespace 삭제/수리는 하지 않았다. 다음 개발 단위는 운영 collation/TZ 대조와 전체 앱·활성 CLI/예약/배포 조립 중 실제 호출 근거가 있는 작은 수직 단위로 고른다. 실 A/B 백업·각 복원·실데이터 복사·최종 전환과 dev→main 조건은 아직 미완료다.

## PostgreSQL runtime 전제 점검 후속 (2026-09-30)

`feature/20260930-mongodb-runtime-composition`에서 첫 조립 선행 게이트로 읽기 전용 `scripts/check-postgres-runtime-contract.ts`를 추가한다. 시스템 카탈로그와 고정 합성 문자열만 사용해 앱의 UTC 세션, UTF8, byte 정렬, collation version을 판정하며 연결 시작부터 read-only다. 합성 PostgreSQL 17/18 C/UTF8은 compatible/0, PostgreSQL 18 ICU `ko-KR`은 ordering 불일치 blocked/2였고 업무 테이블은 모두 0개였다. 실제 운영 DB에는 접근하지 않았으므로 운영 증거는 0이며, blocked/실행 실패를 PASS로 처리하지 않는다. 다음 구현은 이 preflight를 전제로 한 같은 Mongo namespace의 runtime repository 조립이다. 운영 selector·배포 설정·실 A/B 백업/복원·복사·최종 전환과 dev→main은 미완료다.

## 내부 운영 runtime scope 후속 (2026-09-30)

`feature/20260930-mongodb-runtime-scope`에서 외부 원천이 없는 health/adminBackup/requestActivity/coachPrivateAccessLog/activityPrune를 같은 명시 shadow scope로 묶는다. 빈 namespace만 준비하며 기존 namespace는 자동 수리·삭제 없이 전체 open readiness가 맞아야 재개한다. scope lock으로 nested namespace 교체를 차단하고 독립 작업의 두 namespace 병렬 격리를 실제 MongoDB 8.0.30에서 검증한다. 실행·독립 리뷰·통합은 `../mongodb-runtime-scope/` 기록을 따른다. 생산 selector·전체 Next/활성 CLI·예약·배포 조립 및 실 A/B 백업/복원/복사/최종 전환은 미완료다.

## 활동 조회 runtime scope 후속 (2026-09-30)

`feature/20260930-mongodb-activity-read-runtime`에서 완료된 `activityReads`를 관리자 활동·이용 현황·비공개 피드 세 GET의 명시 runtime으로 조립한다. 공통 namespace 소유권 판정을 분리해 다른 runtime 모델만 있는 부분 namespace도 자동 수리하지 않으며, read-only open에는 쓰기 capability를 요구하지 않는다. 실제 MongoDB 8.0.30 handler 검증과 독립 리뷰·통합은 `../mongodb-activity-read-runtime/` 기록을 따른다. `/changes` 쓰기, production selector·전체 앱/활성 작업·운영 이전은 미완료다.

## 공지·첨부 runtime scope 후속 (2026-10-01)

`feature/20261001-mongodb-announcement-runtime`에서 완료된 공지·첨부 repository와 request audit를 같은 명시 shadow scope로 조립한다. 빈 namespace만 준비하고 등록 runtime 객체 분해·중첩 교체를 차단하며 실제 API·페이지의 업무/요청 감사 경계를 MongoDB 8.0.30에서 검증한다. 실행·독립 리뷰·통합은 `../mongodb-announcement-runtime/` 기록을 따른다. production selector·전체 앱/활성 작업·운영 이전은 미완료다.

## 변경 내역 runtime scope 후속 (2026-10-01)

`feature/20261001-mongodb-changes-runtime`에서 `/changes`가 호출하는 activityReads·coachContent·coachEngagement·requestActivity를 같은 명시 shadow scope로 조립한다. 실제 네 handler로 피드·메모·평가·활동 조회와 업무/요청 감사 귀속, 암호화 저장, 부분 준비·재실행 불변, 포트 분해·혼합 차단을 MongoDB 8.0.30에서 검증한다. 실행·독립 리뷰·통합은 `../mongodb-changes-runtime/` 기록을 따른다. 브라우저 전체 흐름, production selector·전체 앱/활성 작업·운영 이전은 미완료다.

## 코치 관리자 runtime scope 후속 (2026-10-01)

`feature/20261001-mongodb-coach-admin-runtime`에서 코치 관리자 페이지·마스터·삭제 코치 API의 coachAdmin·requestActivity를 같은 명시 shadow scope로 조립한다. 실제 페이지·API로 복원·기존 영구삭제·업무/요청 감사·암호화 저장과 부분 준비·중첩 차단을 검증한다. 실행·독립 리뷰·통합은 `../mongodb-coach-admin-runtime/` 기록을 따른다. 브라우저 전체 흐름, production selector·운영 이전은 미완료다.

## 관리자 DB runtime scope 후속 (2026-10-01)

`feature/20261001-mongodb-admin-database-runtime`에서 관리자 DB 페이지·셀 API의 adminDatabase·teamMembers·requestActivity를 같은 명시 shadow scope로 조립한다. 실제 페이지·PATCH, 감사·rollback·준비 재실행/중단·중첩 차단과 자원 소유권을 MongoDB 8.0.30에서 검증한다. 실행·독립 리뷰·통합은 `../mongodb-admin-database-runtime/` 기록을 따른다. 브라우저 전체 흐름, production selector·운영 이전은 미완료다.

## 관리자 유지보수 runtime scope 후속 (2026-10-01)

`feature/20261001-mongodb-admin-maintenance-runtime`에서 과정 관리·삭제 운영·두 보정·request audit를 같은 명시 shadow scope로 조립한다. 실제 삭제→복원→보정 흐름과 준비 불변·scope 차단을 검증한다. 실행·리뷰·통합은 `../mongodb-admin-maintenance-runtime/` 기록을 따른다. production selector·운영 이전은 미완료다.

## 사용자 관리 runtime scope 후속 (2026-10-01)

`feature/20261001-mongodb-user-admin-runtime`에서 관리자 사용자 목록·등록·팀·역할 변경과 토큰 조회를 request audit와 같은 명시 shadow scope로 조립한다. 기존 권한·정규화 중복·응답 최소화·물리삭제 차단을 유지하고 실제 Mongo handler 흐름, 준비 불변, scope 혼입 차단과 저장 평문 비노출을 검증한다. 실행·독립 리뷰·통합은 `../mongodb-user-admin-runtime/` 기록을 따른다. 생산 기본 PG, 실백업 증거 0, 자동화 PAUSED, 운영 이전과 dev→main 미완료 상태는 변하지 않는다.

## 코치 포털 runtime scope 후속 (2026-10-01)

`feature/20261001-mongodb-coach-portal-runtime`에서 코치 토큰 본인 조회와 월 일정 조회·저장, request audit를 같은 명시 shadow scope로 조립한다. 기존 인증·일정 동시성·감사 의미를 유지하고 실제 Mongo handler 흐름, 준비 중단 불변과 scope 혼입 차단을 검증한다. 실행·독립 리뷰·통합은 `../mongodb-coach-portal-runtime/` 기록을 따른다. 생산 기본 PG와 운영 이전/dev→main 미완료 상태는 변하지 않는다.

## 활동 정리 CLI runtime 후속 (2026-10-01)

`feature/20261001-mongodb-activity-prune-cli-runtime`에서 실제 `activity:prune` entrypoint를 기본 PG와 exact 명시 Mongo shadow로 분리한다. Mongo 선택은 준비된 operational runtime만 열고 schema 준비·수리·fallback을 하지 않는다. 실행·독립 리뷰·통합은 `../mongodb-activity-prune-cli-runtime/` 기록을 따른다. 운영 예약·배포 설정과 production 전체 selector, 실데이터 이전/dev→main은 미완료다.

## 현장 투입 보정 CLI runtime 후속 (2026-10-01)

`feature/20261001-mongodb-onsite-backfill-cli-runtime`에서 legacy `db:backfill:onsite-required-y` raw SQL을 기존 operationBackfill command로 교체한다. 기본 PG·dry-run/`--apply` 의미를 유지하고 명시 Mongo는 준비된 admin maintenance shadow만 연다. 실행·독립 리뷰·통합은 `../mongodb-onsite-backfill-cli-runtime/` 기록을 따른다. 운영 보정·예약·배포와 production 전체 selector, 실데이터 이전/dev→main은 미완료다.

## 팀 명칭 보정 CLI runtime 후속 (2026-10-01)

`feature/20261001-mongodb-team-label-backfill-cli`에서 legacy `db:backfill:team-user-team-labels` raw SQL을 TeamUser count/조건부 rename으로 교체한다. 기본 PG·두 exact 라벨·dry-run/`--apply`를 유지하고 명시 Mongo는 준비된 user-admin shadow만 연다. 실행·독립 리뷰·통합은 `../mongodb-team-label-backfill-cli/` 기록을 따른다. 운영 실행·배포와 production 전체 selector, 실데이터 이전/dev→main은 미완료다.

## 코치 운영 매칭 CLI runtime 후속 (2026-10-01)

`feature/20261001-mongodb-coach-operation-match-cli`에서 코치 운영 매칭 진단·백필 raw SQL을 암호화 PostgreSQL/명시 Mongo repository command로 교체한다. 기존 매칭·출력·dry-run/`--apply`를 유지하고 준비된 shadow만 열며 catalog guard·조건부 연결·재실행·오류 비노출을 검증한다. 실행·독립 리뷰·통합은 `../mongodb-coach-operation-match-cli/` 기록을 따른다. 다음 개발 후보는 coach archive service 백필이며 운영 실행·production 전체 selector·실데이터 이전/dev→main은 미완료다.

## 코치 아카이브 서비스 백필 CLI runtime 후속 (2026-10-01)

`feature/20261001-mongodb-coach-archive-service-backfill`에서 legacy raw SQL을 encrypted PostgreSQL/명시 prepared Mongo repository command로 교체한다. 최신 completed archive 선택, 코치 변경 필드와 접속 로그 upsert, backup/maintenance gate, 단일 transaction rollback·재실행·경합 재시도·오류 비노출을 검증한다. 실행·독립 리뷰·통합은 `../mongodb-coach-archive-service-backfill/` 기록을 따른다. 다음 후보는 duplicate-company write CLI 조사이며 운영 실행·production 전체 selector·실데이터 이전/dev→main은 미완료다.

## 중복 회사 병합 CLI runtime 후속 (2026-10-01)

`feature/20261001-mongodb-duplicate-company-merge`에서 legacy raw Prisma CLI를 encrypted PostgreSQL/명시 prepared Mongo repository command로 교체한다. source 회사 보존, 중복 과정·라벨의 제한된 물리 삭제, 회차·비중복 catalog 이동, backup/maintenance gate, 단일 transaction rollback·재실행과 catalog writer 공유 guard를 검증한다. 실행·독립 리뷰·통합은 `../mongodb-duplicate-company-merge/` 기록을 따른다. 운영 실행·production 전체 selector·실데이터 이전/dev→main은 미완료다.

## 강사노트 파일 가져오기 CLI runtime 후속 (2026-10-01)

`feature/20261001-mongodb-instructor-notes-import-cli`에서 legacy raw pg CLI를 encrypted PostgreSQL/명시 prepared Mongo repository command로 교체한다. 암호화 원천 복호화·PII 제거, Notion NO 우선/구형 이름 병합, 기존값 보존·OR 의미, counts-only 로그, apply gate, 단일 transaction rollback·재실행과 부분 namespace 무수정 거부를 검증한다. 신규 생성 guard는 읽기 전용 dry-run을 쓰지 않고 전체 강사노트 writer와 경합한다. 실행·독립 리뷰·통합은 `../mongodb-instructor-note-import-cli/` 기록을 따른다. 운영 실행·실제 원천·production 전체 selector·실데이터 이전/dev→main은 미완료다.
