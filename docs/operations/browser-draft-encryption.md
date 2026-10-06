# 브라우저 개인정보 초안 암호화 — 비교 및 검증 중

> 최신 정책: 사용자가 별도 잠금 암호를 거절하고 기존 로그인 기반 서버 계정키 방식을 승인했다. 아래 passphrase 내용은 과거 독립 실험 기록이며 제품에 적용하지 않는다. 현재 계약은 `docs/operations/browser-draft-integration.md`를 따른다. owner 미정 legacy 전환은 별도 결정 대기다.

2026-09-21 최신 사용자 정정에 따라 서버와 브라우저 초안 모두 암호화 완료 조건이다. 이전 인계의 브라우저 제외 방침은 철회되었다. 별도 잠금 암호 UI 도입은 사용자 승인 대기이며, 현재는 독립 프로토타입만 구현했다. 실제 폼은 기존 localStorage 경로를 사용하므로 전체 완료 상태가 아니다.

## 키 관리 비교 및 추천

| 방식 | 서버 없는 재시작 복구 | 보호 범위와 실패 조건 | 판단 |
|---|---|---|---|
| 비추출 CryptoKey를 IndexedDB에 함께 보관 | 같은 브라우저 저장소가 유지되면 가능 | raw export를 막지만 같은 origin 코드가 키를 읽어 decrypt 가능. 앱 계정 전환은 origin 분리가 아니므로 별도 인증 비밀이 생기지 않는다. 하드웨어 보관 보장도 아님 | 계정 경계 요구의 단독 대안으로 제외 |
| 사용자 잠금 암호로 랜덤 데이터키 wrapping | 암호와 wrapped key/salt가 있으면 서버 없이 가능 | 약한 암호는 오프라인 추측에 취약. 암호 분실 시 해당 잠긴 로컬 초안을 복구할 수 없다. 이미 서버에 저장된 업무 기록을 삭제하는 것은 아님 | 기본안 추천, 사용자 승인 필요 |
| WebAuthn PRF 인증기로 데이터키 보호 | 실제 인증기/브라우저가 로컬 PRF 사용을 지원할 때 가능 | client 지원 표시는 인증기 지원 증거가 아님. 결과 부재, 인증기 분실/동기화/기기 교체, OS 사용자 검증 실패 조건 확인 필요 | 향후 선택 옵션, 모든 사용자 기본안으로 미채택 |

공식 근거: [Web Crypto 저장 및 보안 모델](https://www.w3.org/TR/webcrypto/#security-considerations), [CryptoKey 저장](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto), [wrapKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/wrapKey), [WebAuthn PRF](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions#prf).

추천안의 체감 변화는 최초 초안 잠금 암호 설정, 탭/브라우저 재시작 또는 로그아웃 후 잠금 해제이다. 복구키는 분실 위험을 줄이는 추가 보관/회수 비용의 대안이며 이번 작업의 필수 조건으로 확대하지 않는다. 비밀을 사용자 ID·고정 문자열·앱 secret에서 파생하지 않는다. 암호 또는 추출 가능한 원시 키를 암호문과 함께 저장하지 않는다.

## 위협 모델

- 다른 앱 계정: 정상 앱은 로그인 owner별 namespace를 사용하고 로그아웃/계정 변경 시 키와 열린 초안 UI를 잠가야 한다. namespace 자체가 암호학적 인증은 아니다. 잠금 암호를 아는 사람이 로컬 보관함을 여는 것과 서버 로그인을 구분한다.
- 같은 기기·브라우저 사용자: 잠긴 wrapped key와 암호문만 얻으면 별도 비밀 없이 즉시 복호화할 수 없도록 한다. 암호 공유/추측 및 기기 입력 감시까지 막지는 못한다.
- 같은 origin JS/XSS: 잠금 해제된 데이터·사용자가 입력하는 암호를 읽을 수 있다. nonextractable 표시는 decrypt 권한을 제거하지 않는다. 암호화가 XSS 방어를 대신하지 않는다.
- 기기 관리자/브라우저 프로세스 장악: 메모리/키보드/프로필 접근을 이 웹앱 암호화로 방어한다고 주장하지 않는다.
- 오프라인: 서버 최신 권한·계정 회수 상태를 확인할 수 없다. 로컬 잠금 해제는 서버 인증/권한 부여가 아니다.
- 사용자 저장소 삭제·브라우저 eviction·장치 분실: 암호화는 유실 방지나 백업이 아니다. persistent 요청은 승인 여부가 다르고 사용자의 사이트 데이터 삭제를 막지 못한다. [브라우저 저장소 정책](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## 현재 코드와 복구 화면

현재 앱에는 service worker가 없고 root layout이 서버의 인증/권한 판정을 수행한다. 기존 localStorage는 서버 복구 후 복원할 수 있는 저장 방식이지, 서버 중단 중 새 브라우저에서 복구 UI까지 다시 열린다는 보장이 아니었다. 확인되지 않은 종전 보장을 전제로 삼지 않는다.

독립 fixture는 고정 HTML/JS 5개만 캐시하는 최소 복구 화면이다. 업무 페이지·서버 인증 응답·API·초안 원문을 cache하지 않는다. 앱 전체를 오프라인 앱으로 확장하지 않았다. 실제 앱 적용 때는 HTTPS 동일 origin의 별도 복구 경로, SW scope/업데이트·삭제 및 안전한 서버 복귀 절차를 검토해야 한다. [Service Worker 오프라인 캐시](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

## 프로토타입 구현

- `src/lib/privacy/browserDraftCrypto.ts`: PBKDF2-SHA256 wrapping key + 랜덤 AES-256-GCM 데이터키, 랜덤 IV, owner/kind/operation/version AAD, 해제 후 비추출 키. PBKDF2 기본 600,000회 및 초안 8MiB는 프로토타입 자원 상한이며 최종 제품 성능/암호 정책은 미확정이다.
- `src/lib/privacy/browserDraftStore.ts`: IndexedDB ciphertext/envelope만 허용, vault add 충돌 보호, strict durability를 요청하고 지원을 확인한 transaction oncomplete 후 성공 보고. 원문 읽기 오류/변조/암호 오류에 평문 fallback 없음.
- 기존 평문 전환: owner 확인 없는 자료는 배정·삭제하지 않는다. 영속 보관함의 키 복구, 암호화 commit 및 별도 immutable recovery 사본과 동일 vault의 strict commit, 재조회·복호화 일치, 원문 변경 없음 확인 후에만 삭제한다. 일반 초안 writer는 recovery 사본을 덮어쓰지 못한다. strict 미지원 또는 이관 충돌이면 원문을 유지한다. localStorage에는 cross-tab CAS가 없으므로 기존 평문 writer를 멈추는 실제 전환 조정은 필수다. 이를 확인할 수 없다면 원문 삭제 없는 전환만 허용해야 한다. 확인되지 않은 자료는 평문 미해결 항목으로 남는다.
- `scripts/privacy-browser-fixture/`: 실제 앱과 다른 localhost origin의 가짜 데이터 전용 서버·UI·SW. 제품에 import하지 않는다.

## 검증 상태

Browser 스킬로 실제 Codex 내장 브라우저의 격리 origin에서 수행:

1. WebCrypto/IndexedDB 사용 가능, PRF client advertised=true, 실제 인증기 PRF는 미검증, persistent storage=false.
2. 비추출 CryptoKey를 실제 IndexedDB에 쓰고 다시 읽음: raw export 거부, 같은 origin JS의 암호 없는 decrypt 성공. 이 때문에 단독 보관 방식을 추천하지 않는다.
3. 온라인 초안 저장 → fixture HTTP 서버 실제 종료 → 열린 탭에서 다른 초안 저장(commit 확인) → 탭 닫기 → 새 탭 동일 URL → cached shell 표시/잠금 상태 → 암호 unlock → 서버 중단 후 마지막 초안 복구 성공.
4. 가상 계정 A 잠금/로그아웃 → 가상 B 선택: 열린 초안 비우기·키 제거·복구 거부. 실제 NextAuth A/B 전환은 미검증.
5. 다른 owner AAD, 암호문 변조, 틀린 암호, raw export 거부; 기존 ciphertext 보존 확인.
6. 최신 코어에서 immutableRecoveryVerified=true를 실제 IndexedDB로 확인. 소유자 불명확한 합성 legacy 초안은 그대로 유지. 확인된 합성 초안만 저장 후 읽기/복호화 확인 뒤 원문 제거.

7. 기존 v2 캐시 화면에서 v3 업데이트 후 활성 버전=3, 고정 자산 5개 및 controller 일치 확인. 자산 적재 후 활성화 전 의도적으로 실패한 후보를 설치하여 failedCandidateRejected/previousControllerRetained/previousCacheEntriesRetained 모두 true 확인. 그 상태에서 HTTP 서버 종료→추가 저장→탭 닫기/새 탭→암호 해제 후 마지막 저장본 복구도 통과. 구버전 UI의 준비 완료 표시는 활성화 증거가 아니며, 최신 UI에서 별도로 확인한다.

전체 검증(독립 review 보완 전): 548개 중 544 pass/DB 4 skip, typecheck/lint/build 통과. 보완 후 관련 crypto/store 회귀 23개 전부 통과, typecheck 및 변경 파일 eslint 통과. 테스트 로그와 추가 증거는 `.claude/plans/browser-draft-encryption/handoff.md` 참조. strict 요청과 recovery 사본은 브라우저 저장소 삭제·eviction·하드웨어 장애를 막는 보장이 아니다. [IndexedDB durability 옵션](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction).

탭 재생성은 브라우저 프로세스 완전 종료/OS 재시작 검증이 아니다. 서버 중단은 확인했으나 OS 네트워크 전체 차단은 별도 미검증이다. 실제 기기 관리자/XSS 방어, 모든 브라우저/인증기 호환성을 증명하지 않았다. quota/abort 오류는 주입 fixture로 검증하며 실제 디스크를 가득 채우는 실험은 하지 않는다. 브라우저 저장소 강제 삭제/eviction 내구성은 보장하지 않는다.

## 남은 완료 조건

별도 잠금 암호 제품 승인 → 실제 세 초안 폼/로그아웃/계정 전환 연결 → 소유자 불명확 legacy 처리 및 열린 writer 조정 → 실제 앱의 최소 복구 shell → 새로고침/탭/브라우저 재시작과 장애 중 복구 검증이 필요하다. 작성 중 입력은 암호화와 commit이 끝나기 전에 저장 완료로 표시하면 안 되며, 실패 시 유일 사본을 버려서는 안 된다. 현 단계에서 서버+초안 전체 암호화 완료를 선언하지 않는다.
