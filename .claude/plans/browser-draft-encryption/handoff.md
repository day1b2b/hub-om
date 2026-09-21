# 독립 구현 인계 — 제품 적용 대기

상태: 독립 구현·검증 완료, 전체 작업 미완료. 별도 잠금 암호 제품 결정 대기. 실제 폼/실제 legacy 전환 금지. 서버와 브라우저 전체 완료 아님.

## 구현 위치

- `src/lib/privacy/browserDraftCrypto.ts`, `.test.ts`: 사용자 비밀로 랜덤 데이터키 wrapping/해제 및 scope AAD 암호화.
- `src/lib/privacy/browserDraftStore.ts`, `.test.ts`: ciphertext IndexedDB 저장, 영속 보관함 기반 합성 legacy 전환.
- `scripts/privacy-browser-fixture/`: 가짜 데이터만 사용하는 localhost UI/서비스워커. 제품 import 없음.
- `docs/operations/browser-draft-encryption.md`: 키 대안 비교·공식 출처·위협 모델·검증 한계.

## 검증 증거

독립 review 보완 전 전체 테스트: 548개 중 544 통과, 실패 0, DB 4 skip. `/tmp/hub-om-browser-draft-tests.log`.
Typecheck/lint 통과(기존 lint 경고 7). Build 통과: `/tmp/hub-om-browser-draft-build.log`.

실제 Codex 내장 브라우저 가짜 origin 41873: 온라인 저장 → HTTP 서버 프로세스 종료 → 열린 탭 추가 저장 commit → 탭 닫기 → 새 탭 캐시 UI → 잠금 암호 → 마지막 초안 복구. 가상 B 선택 시 입력란 비워짐/잠김/복구 거부.
가짜 origin 41874: 최신 영속 vault 기반 이관에서 owner 미확인 원본 보존, 확인 후 재복호화·원문 제거. 실제 native duplicate vault transaction abort, 주입 quota 오류 후 기존 암호문/보관함 보존.

독립 review에서 암호문 writer가 최종 검증 중 목적지를 덮어쓰는 경합을 재현. immutable 이관 복구 사본 및 strict durability 검사를 추가하고 회귀 23개(crypto 11/store 12) 전부 통과. `/tmp/hub-om-browser-draft-regression.log`. 보완 후 typecheck 및 변경 파일 eslint 통과: `/tmp/hub-om-browser-draft-typecheck.log`, `/tmp/hub-om-browser-draft-lint.log`. 이 내구성 요청은 사이트 데이터 삭제, eviction, 하드웨어 장애를 막는 보장이 아니다.

추가 실제 브라우저 증거: 기존 v2 화면→v3 업데이트 후 activeVersion=3, controllerReady=true, 고정 캐시 자산5개. 설치 후보를 자산 적재 후 의도 실패시켜 failedCandidateRejected/previousControllerRetained/previousCacheEntriesRetained=true. 최신 store로 합성 legacy 이관 시 immutableRecoveryVerified 및 owner 미확인 보존 모두 true. 이어 서버 종료→strict 저장→탭 닫기/새 탭→잠금 해제→마지막 초안 복구 통과. 최종 DOM은 `browser-evidence.md`에 보관.

## 미검증/남은 작업

- 사용자 잠금 암호 결정 전 제품 폼, 로그아웃 연결, 실제 legacy 자료 변경 금지.
- 승인 후 세 폼의 진행 중 입력 보존, owner 불명 자료 처리, old writer 중단, 최소 복구 화면 연결.
- 탭 재생성만 확인. 브라우저 프로세스 전체 종료/OS 재시작, 네트워크 전체 차단, 실제 NextAuth A/B 전환 미검증.
- PRF client advertised=true만 확인. 실제 인증기 PRF 미검증. 저장소 persistent=false.
- quota는 오류 주입이며 실제 용량 소진 실험 아님. DB 4 skip은 계속 유효.
- 실제 키/DB/배포/push/원격 merge 없음. 사용자 결정 이후 제품 검증 없이 전체 완료 선언 금지.
