# 매출 동기화 인계

기준 a52f191f0f5ffd6aeb805eea8e040ab78196eb6c, feature/20260929-mongodb-sales-revenue-sync. 격리 clone `/Users/ga/workspace/hub-om-mongodb-coach-content` 재사용. Initiative PG→Mongo/개인정보 암호화, 전체 runtime Wave 진행 중.

Lifecycle: complete (이번 기능·검증 단위). Artifact: complete. Rigor: Level3/R1–R6=6. Resume: start_next_task. Alignment: update_next_task.

완료한 제품: source/repository/notifier port, PG기본과명시Mongo/factory/context/실제GETPOST. 최초snapshot의중복pending/다중딜/금액/partial/재실행과별도sync/request감사·알림실패경계유지. Mongo최신행부분갱신·원자적변경감사·실writer경합. shared numericMoney는기존admin오류코드유지. privacy/schema/dependency/권한/삭제정책변경없음.

검증: 일반910pass57skip0fail; 전체Mongo577pass0skip0fail(mock4포함); PG5pass로원본/newPG/Mongo각45상황×3단계=135대조; type/buildPASS,lint0error기존7warning. native28/actualhandler17/source4는중복합산금지. 마지막T15 test만추가되어PG/type/lint를다시확인했다. 상세실패/보완/한계는execution-review/gap-plan. 소유PG56699/Mongo27799정상종료,남은합성DB0,dbpath2개제거·부재확인,cleanup exit0. root `/private/tmp/hub-om-sales-revenue-20260929` 로그·스크립트보존.

Do Next: 독립V1–V3수락및feature 4ff323476a9ba388588c4b887ae02879e4ab696f 원격일치/총괄FF·동일제품원격일치완료. 후속문서HEAD는integration-review와Git최종원격을따른다. 새Task는OM접수·배정. 이미완료한매출/강사/기타경계를다시구현하지않는다.

Read order: handoff → execution-review → independent-final-review/integration-review → runtime-coverage/cutover-remaining → macro/적용규칙.

Do Not: 운영DB/Atlas/실Salesmap/Slack/Notion/Google/PII/운영키/env/권한/배포/main/dev/원본workspace/자동화변경금지. 공개Course/빈DB로키정당성을증명하지않음. 실제네트워크commit불명확/운영부하/브라우저/전체앱/실복사·복원·전환은미검증. 실제운영실행은구체적백업/범위/복귀조건확인이필요하다. 생산기본PG,전체완료/dev→main미완료.
