# Execution Review

독립 리뷰(code-reviewer, 읽기 전용): P0/P1 없음. P2 2건과 P3 일부를 반영했다.

| 기준 | 결과와 근거 |
|---|---|
| V1 정책 | 두 필드 encrypted 분류, HMAC companion unique. 계약 snapshot은 migration 계약에서 재생성해 diff가 companion 2개와 unique 대상뿐임 |
| V2 조회·매칭 | PG wrapper equality/`in`/findUnique/upsert가 HMAC으로 동작. Mongo `findMatchingEngagement` HMAC 조회 후 원문 확인. course 변경 재동기화에서 created 0(PG·Mongo 실제 workflow/handler) |
| V3 고유성 | 랜덤 암호문 unique만으로는 불충분함을 PG 혼합 상태에서 재현. HMAC unique가 PG P2002, Mongo 11000(keyPattern이 `*PiiIndex`)으로 동일 원문 차단 |
| V4 기존 데이터 | 스키마 전 backfill은 companion 컬럼 오류로 batch 롤백. migration 후 dry-run 206/2 평문. 유지보수 위반 중복 → unique 충돌로 중단, 200행 부분 커밋, 검토 후 재시도, 재실행 시 암호문 불변. 암호화 키 불일치 dry-run 실패, HMAC 키 불일치 invalidIndexes·enforce 거부. enforce 후 평문 SQL은 `pii_encrypted_storage`(23514) 거부 |
| V5 shadow | 이전 정책 문서가 있는 기존 namespace는 `EXISTING_DOCUMENTS_POLICY_MISMATCH`, 문서·validator 불변, open 실패. 검사와 collMod 사이 경합은 validator/level/action 복원 후 실패. 실제 importer로 채운 새 namespace는 prepare·open·HMAC 매칭 통과 |
| V6 비노출 | PG 저장행·activity_changes, Mongo 저장·감사·요청·동기화 로그에 이름/원문 source ID 없음. 감사 diff는 redacted. 기존 테스트의 CoachEngagement 이름 평문 예외 제거 |
| V7 음성 대조 | 수정 전 매칭/준비 코드로 되돌리면 신규 Mongo subtest 2개 실패(재동기화 중복, 이전 정책 통과). 원복 후 통과 |

## 최종 실행 (리뷰 반영 후)
- Node 24.19.0 절대 경로 + `env -i`.
- 일반 `npm test`: 896 total / 876 pass / 20 skip / 0 fail. skip +1은 전용 DB 주소가 없을 때의 신규 PG 테스트.
- Mongo 8.0.30 replica set 묶음(파일 concurrency 2): 112 pass / 0 fail / 0 skip. mock 4 포함, 신규 subtest 2. 일반 수치와 합산하지 않는다.
- PostgreSQL 17.9 격리: 신규 전환 테스트 1 pass. 기존 PII·활동·과정명 복원 21 pass는 리뷰 반영 전 같은 PG 경로 코드로 실행했고, 리뷰 반영은 PG 런타임 코드를 바꾸지 않았다.
- `npm run typecheck`, `npm run build`: exit 0. `npm run lint`: 0 error, 기존 7 warning(변경 파일 밖). `git diff --check` exit 0. `prisma validate` 통과, 적용 DB와 두 테이블 schema drift 없음.

## 미검증과 한계
운영 PG migration/backfill/enforce, 운영 규모 시간·잠금, PG export→spool→import 전체 CLI의 실제 재복사·복원 리허설, 대형 컬렉션 prepare 스캔 시간, migration 전 새 코드 조회 실패(코드 추론). PG 매칭 경로는 HMAC 후 원문 재확인을 하지 않는다(충돌 확률 무시 수준, 리뷰 동의). 전체 앱 전환·브라우저 초안·운영 이전은 범위 밖이며 완료가 아니다.

## 정리
합성 DB·직접 기동한 PG/Mongo 프로세스·dbpath 정리 결과는 최종 인계 메시지에 기록한다.
