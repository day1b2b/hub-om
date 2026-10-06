# 기존 초안 격리 전환: 클라이언트 구현·검증

2026-09-21. 사용자 승인에 따라 기존 4개 prefix의 원문을 현재 로그인 계정에 귀속하지 않고 별도 암호화 보관한다. 실제 운영 키·DB·OAuth·배포는 변경하지 않았다. 서버 계약과 복구 절차는 [서버 문서](legacy-draft-quarantine-server.md)를 따른다.

## 전환 순서와 경계

1. 공통 Provider는 로그인 초안 기능이 준비되면 두 Web Storage의 알려진 4개 prefix를 key 이름으로만 센다. 화면에는 개수만 표시한다.
2. 사용자가 보호를 시작하면 현재 원문/원본 key/저장소 종류/nonce를 서버 seal API에 보낸다. 원본 key에 이메일이 있어도 암호문 안에만 들어간다. 원문은 로그나 UI로 출력하지 않는다.
3. 전용 IndexedDB `hub-om-legacy-quarantine-v1`의 `records`에 opaque envelope ID로 `add`한다. `put`·삭제 API는 없으며, 동일 ID 쓰기는 실패한다. strict durability와 transaction complete를 확인한다.
4. 저장된 record를 다시 읽어 정확히 비교하고 그 readback을 서버 verify API로 보낸다. 서버의 verified/id/nonce가 일치해야 다음 단계로 진행한다.
5. 원문이 바뀌지 않았는지 다시 확인한다. 바뀌었다면 기존 암호문은 유지하고 새 값을 다시 봉인한다. 항목당 최대 두 번 시도하며 계속 변경되는 원문은 남겨둔다.
6. 삭제 조건이 충족됐을 때만 최종 동기 compare/remove를 수행한다. quota·readback·서버검증·계정세대·marker 저장 실패에서는 삭제하지 않는다. 이미 저장한 암호문은 실패해도 지우지 않는다.

암호문 사본 수는 원문 항목 수와 같지 않을 수 있다. 실패·재시도·값 변경 때 불변 사본을 추가하기 때문이다. 사본 개수가 있다는 사실만으로 재검증/원문 제거 완료를 표시하지 않는다.

## 다른 탭과 sessionStorage

localStorage는 compare-and-swap을 제공하지 않는다. Web Locks나 BroadcastChannel은 구버전 탭을 중단시킬 수 없고, 새 Service Worker 도입도 모든 기존 미제어 client를 즉시 증명하는 수단이 아니다. 새 Service Worker는 도입하지 않았다.

- 먼저 각 기존 탭에서 작성 중 입력을 저장하고 새로고침하여 새 코드로 전환한다. 탭을 먼저 닫으면 해당 탭 sessionStorage의 유일 원문을 잃을 수 있다.
- 각 탭의 보호 시작은 검증된 해당 sessionStorage 원문을 정리한다. localStorage는 이 단계에서 사본만 보존한다.
- 다른 앱 탭·창·앱을 포함한 프레임에서도 보호를 마친 뒤 닫는다. 마지막 화면에서 이 조건 및 전환 중 새 탭을 열지 않을 것을 명시적으로 확인해야 공유 원문 재검증/제거 버튼이 활성화된다.
- 이것은 필수 운영 전제이며 구버전 writer가 0개라는 기술적 증명이 아니다. 확인하지 않으면 공유 원문을 제거하지 않는다. 같은 현재 탭에 구버전 앱 프레임을 계속 두는 것도 허용하지 않는 전제다.
- 신규 코드끼리의 이관·등록 marker 해제는 같은 Web Lock으로 직렬화한다. 잠금 미지원 브라우저는 암호문 복사만 허용하고 원문 제거·marker 해제를 거절한다.

전환 안내는 현재 브라우저 공유 저장소와 현재 탭의 관찰 결과만 표시한다. 다른 탭·프로필·기기의 평문까지 없어졌다고 선언하지 않는다. 접근 불가능한 저장소는 빈 저장소와 구분한다.

## 신규 등록 중복 방지

등록 재개 원문을 제거하기 전에 non-PII 상수 marker `hub-om:legacy-registration-unresolved:v1`을 localStorage에 기록하고 읽어 확인한다. marker 저장 실패 시 원문은 남긴다. 격리 보관만으로 새 등록 차단을 해제하지 않는다.

원문 등록 정보가 더 이상 남아 있지 않으면 사용자는 운영 현황에서 기존 등록 여부를 확인했다는 체크와 명시적 새 등록 허용 action을 수행할 수 있다. 이 action은 소유권 증명도, 과거 요청의 성공 판정도 아니다. marker만 정리하고 격리 암호문은 유지한다. 이후 새 등록은 새 UUID를 사용하며 옛 submission을 복호화해 폼에 넣거나 계정에 연결하지 않는다. marker 정리 실패나 계정 변경 시 차단을 유지한다.

정상 완료 상태는 한 줄 요약과 접힌 details로 표시한다. 원문·검증실패·미확정 등록·저장소 오류가 있으면 상세 안내를 유지한다.

## 담당 변경 파일

- `src/lib/privacy/legacyDraftSources.ts`: key-only 조사/marker 정의.
- `src/lib/privacy/legacyDraftQuarantineStore.ts`: append-only strict IndexedDB.
- `src/lib/privacy/legacyDraftTransition.ts`: seal→commit→readback→verify→조건부 삭제, 협력 잠금, 새 등록 확인.
- `src/components/LegacyDraftTransitionNotice.tsx`, `BrowserDraftProvider.tsx`: 두 단계 전환 UI.
- `src/features/operations/operationSubmission.ts`, `operationDraftSession.ts`, `src/app/operations/new/OperationCreateForm.tsx`: 기존 안내 정합성, 원문/marker 검사와 새 등록 허용 event 반영.
- 담당 tests 및 `scripts/draft-product-fixture/entry.tsx`, `serve.mjs`: 합성 검증.

## 자동 검증

Node 24 기존 의존성만 사용했다. 담당 표적 테스트 21/21 통과(소스 조사 2, 전환 10, 실제 등록 TSX 9). 명령:

```sh
node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test src/lib/privacy/legacyDraftSources.test.ts src/lib/privacy/legacyDraftTransition.test.ts src/app/operations/new/OperationCreateForm.test.ts
```

로그 `/tmp/legacy-client-tests.log`. 실제 서버 암복호화 함수를 사용해 원문/키 roundtrip, commit 전 제거 0, 기본 local copy-only, quota/read/verify 실패, marker 실패, 변경된 원문 재봉인과 불변 사본 유지, 지속 writer 중단, 계정세대 변경 시 전체 중단, nonce 불일치, 잠금 미지원, 명시적 marker 해제를 검사했다. 담당 source/fixture ESLint 및 `git diff --check` 통과. 전체 검사 결과는 총괄 문서를 따른다.

## 실제 브라우저 검증

41876 합성 origin에서 실제 Form·Provider·WebCrypto·native IndexedDB·전용 서버 암호화/검증 함수를 사용했다. 인증·업무 API·navigation은 fixture이며 키는 고정된 공개 합성 bytes만 명시 주입했다.

| 시나리오 | 관찰 결과 |
| --- | --- |
| 4종 원문 seed 후 verify 응답 실패 | 암호문 4사본 저장, 원문 session 1/local 3 모두 유지, 검증 0/제거 0/미완료 4 |
| 다음 native IDB 쓰기 quota 오류 주입 | session 원문 유지, local 원문 3개 유지, 사본 7개, 제거 0/미완료 1 |
| 정상 보관 재시도 | session 1개 검증 후 제거, local 3개 유지, 사본 11개, unresolved marker true, 등록 폼 잠금 |
| 단일 작성 화면 조건 체크 후 공유 제거 | local 3개 재검증 후 제거, 현재 조사 범위 session/local 0, 사본 14개, marker true로 등록 차단 지속 |
| 명시적 운영 현황 확인 후 새 등록 허용 | 사본 14개 그대로, marker false, 폼 활성화, 옛 원문 비노출 |
| 새 과정 등록 | 새 UUID 기반 요청 1회/생성 1건, 상세 이동 요청 확인 |
| 재로드 후 본인 계정 로그인 | 원문 정리 완료/암호문 14개 한 줄 요약, 상세 기본 접힘 |

모든 inspector 실행에서 plaintextPresent false, sourceKeyPresent false, immutable true를 확인했다. immutable은 이미 존재하는 native IndexedDB ID로 add를 시도해 거절되는지 확인한 결과다.

로컬 임시 증거: `/tmp/legacy-quota-dom.txt`, `/tmp/legacy-first-stage-dom.txt`, `/tmp/legacy-removed-dom.txt`, `/tmp/legacy-fresh-dom.txt`, `/tmp/legacy-compact-dom.txt`, `/tmp/legacy-transition-compact.png`.

## 남은 한계와 인계

실제 저장 용량을 가득 채우지 않고 DOMException을 주입했다. 운영 DB·Google OAuth·실제 키 회전·브라우저 프로세스 재시작은 검증하지 않았다. 실행 중 구버전 writer를 강제로 종료하거나 모든 client가 닫혔다고 증명하지 않는다. 배포 전에는 전용 키 보관/복구와 탭 전환 운영 절차가 필요하다.

제품 source는 총괄에 freeze를 알렸다. 최종 독립 검토·전체 lint/typecheck/test/build·커밋은 총괄 담당이다. 운영 반영·새 의존성·실제 키 설정·push/merge는 하지 않는다.
