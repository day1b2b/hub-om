# 실행 검토

## 구현과 기존 의미

기존 두 async export와 DTO 경로를 유지하며 기본 PG 본문을 별도 adapter로 옮겼다. 원본 함수 본문과 helper의 byte 대조를 수행했다. 명시 scope는 환경변수보다 우선하고 누락은 rejected Promise로 실패한다. 페이지는 실제 workspace 인증 후 두 저장소 선택을 마쳐야 읽는다.

Mongo는 하나의 read-only snapshot, 전체 고려 후보 인증 후 정렬/take, nullable session identity-only 검사, 실제 raw BSON 누적 budget을 쓴다. 업무/감사 write0을 native wire와 raw snapshot으로 검증했다. 선택 밖 손상도 고려 집합에 있으면 실패하는 의도적 PG 차이, synthetic C collation만 검증한 한계는 operations 문서에 명시했다.

## 독립 기준과 증거

- V1: baseline73a137a frozen closure76파일/26runtime 및 loader/schema/package manifest. current 경로 탈출·source/loader 변조 negative controls 포함. original/current/native 별도 worker, 독립 literal full DTO 사용.
- V2: 기본 PG env/실제 query/decode/변환 실패는 null. 변환 실패는 실제 조회·복호화 뒤 Date.toISOString fault injection이며 저장 손상과 구별한다. 명시 scope 누락·양 환경·동시 native namespace 분리·PG/fetch 호출0 확인. Calendar 등록 scope 회귀24 수락.
- V3–V4: 정상 전체 DTO·exact own keys·타입·다중성·비동률 순서·허용 동률집합·음수/소수/큰 take·Unicode byte 순서·finishedAt ISO 확인. parity root1 내부55/55/48 cases이며 숫자를 독립 테스트로 부풀리지 않는다.
- V5: native 부모/nullable/다른 namespace/soft-delete/다른 현재operationId/무관 session private payload, 실제 snapshot interleaving과 controller 변경만 분리 확인.
- V6: codec/key/policy/보호 필드 저장·반환/비반환 인증, 오류/console5종 canary0. 행20k·32MiB의 실제 BSON/부모 재수신 누적, scan15s/call60s 시간 주입, 실제 pending read timeout/후속 currentOp0. 시간 주입과 실제 pending 중단 증거를 구분한다. cleanup ACK fault는 실제 close/end 이후 fault이며 서버 정리 실패의 재현이 아니다.
- V7: 실제 원본PG/currentPG/native reader→page SSR7/8/8. 실제 guard·SessionProvider·페이지/presenter 유지, auth platform 입력만 합성. 250행·셀·href·team query·6지표·후보6/4·이슈3·error 우선·legacy object 렌더 실패. 실제 브라우저/OAuth 증거 아님.
- V8: 일반957/83skip, type/build PASS, lint기존7, native79/0skip, Calendar24/0skip. 최종 native 이후 소스 변경은 페이지 테스트의 lint-only 수정1파일뿐이며 해당3backend/type/lint/general 재실행. 제품 변경0. 단일 최종 SHA의 전체 Mongo 실행이라 주장하지 않는다.
- V9: 35개 업무 테이블 빈 상태와 다른 PG client0, Mongo admin/config/local 외DB0·owned operation0 직접 확인. 서버 종료/port폐쇄/dbpath삭제 확인. 소유 자원만 정리. 실제 원천·운영 설정·원본workspace·자동화 변경0.

## 실패를 보존한 수정 이력

1. 초기 smoke는 Node strip-only parameter property 지원 문제로 접속 전 실패. 제품의 명시 필드 초기화로 수정 후 성공.
2. 최초 page loader가 frozen data URL을 file URL로 오인해 seed 전 실패. file scheme guard 후3backend 통과.
3. 초기 typecheck는 fixture unknown/children 및 native options 타입 문제. 제품 계약 변경 없이 fixture 수정 후 최종통과.
4. native 첫 실행74중18pass/56fail: installed driver의 batchSize101(limit100), Array.prototype mock.method 제약을 잘못 단언. 실제 wire 의미와 descriptor restore로 보완.
5. native 두 번째74중21pass/53fail: sort Map을 plain object로 비교, cleanup5s timeout. ordered entries로 정확 방향·순서 검사하고 test cleanup은 별도 total30s budget/삭제후부재 확인. 제품 cleanup5s는 그대로. 실패 뒤 부모 audit에서 소유DB/작업0 확인했으나 실패 wrapper를 PASS로 바꾸지 않았다.
6. 최종 native79/0skip/exit0. 독립 검토가 요청한 101행 두 페이지에서 scan8s+8s/두번째 timeout7s, console5종도 추가. 제품 변경 없이 테스트 공백 보완.
7. parity finishedAt와 PG DTO변환 실패 공백 보완 후55/55/48 및 독립 수락.
8. lint 첫 오류는 page createElement children prop1개와 unused 인자2개. 실제 SessionProvider의 타입 별칭과 세번째 children 인자로 수정. 최종 lint0error/기존7warning. 재실행 첫 page 명령에 필수 PG_DATA_DIRECTORY를 누락하여 seed 전 거부; 코드 변경 없이 정확한 소유경로를 명시한 accepted 로그3개가 최종증거다.

원시 실패 로그와 최종 로그를 모두 durable evidence에 보존했다. 현재 수락을 위해 같은 검사를 불필요하게 반복하지 않았다. build는 page lint-only test 수정과 제품 dependency가 겹치지 않으며 최종 타입 검사는 그 수정 후 별도로 통과했다.

## 미완료와 다음 범위

companyName/courseName snapshot은 기존 privacy registry 비보호이며 암호화 제외 승인 아님. 전체 이전의 보안 검토 차단 항목으로 유지한다. 운영 collation 대조 미실시. dry-run CLI의 실제 이력 writer, source candidates/apply, Sheets/Notion 가져오기, 전체 요청/작업 조립, backup/health, 실제 A/B 백업·복원·복사·전환은 별도다. 다음은 Sheets tabs/import의 합성 원천→기존 staging 경계 계획이다. dev→main은 아직 실행하지 않는다.
