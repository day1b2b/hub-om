# 기존 초안 격리 서버 및 오프라인 복구

기존 초안의 작성자는 알 수 없다. 로그인 계정은 봉인 요청과 검증을 수행하는 인증 주체일 뿐이며, 격리 사본 보유·복호화 성공·현재 계정 이메일 어느 것도 작성자 증명이 아니다. 일반 사용자에게 원문을 반환하거나 계정 초안에 자동 이관하는 API는 없다.

## 독립 키 설정

- `BROWSER_DRAFT_QUARANTINE_KEYS`: 키 ID → 독립 난수 32바이트의 canonical base64 문자열 JSON 객체. 1~8개, ID는 영문/숫자/밑줄/하이픈 1~40자.
- `BROWSER_DRAFT_QUARANTINE_ACTIVE_KEY_ID`: 새 봉인에 쓰는 ID.
- `BROWSER_DRAFT_APP_ORIGIN`: 명시적 공개 HTTPS origin. 기존 keyring과 동일한 origin 정책이며, 없으면 `AUTH_URL` 사용. 프로덕션에서는 설정이 필수다.

실제 환경과 비밀키는 이 구현에서 변경하지 않았다. 격리 키는 AUTH/NEXTAUTH, PII, 정상 초안 master/owner 키와 별도로 생성해야 하며 같은 키 재사용은 거부한다. 각 격리 root에서 HKDF로 AES-GCM 키와 HMAC 키를 별도 유도한다. 격리 root 및 파생 키는 브라우저로 보내지 않는다. 서버 DB나 스키마는 추가하지 않는다.

키 교체 시 새 ID를 추가하고 active만 전환한다. 기존 사본이 남아 있는 동안 이전 ID와 **그 ID의 원래 키 바이트**를 보존해야 한다. 기존 ID의 키를 바꾸거나 삭제하면 해당 사본은 복구할 수 없다. 암호문과 별도로 키의 접근 통제·백업을 운영해야 한다.

## API 계약

`POST /api/browser-drafts/quarantine/seal` 입력은 `{snapshot}`이다. snapshot은 `{version:1,source,storageKey,rawValue,nonce}`이고 source는 localStorage 또는 sessionStorage, nonce는 UUID v4다. 저장소 두 종류 각각에서 아래 네 접두사를 허용한다.

- `hub-om:lecture-note-draft:`
- `hub-om:issue-review-draft:`
- `hub-om:drive-import-draft:`
- `hub-om:operation-submission:v1:`

rawValue 자체는 JSON으로 파싱하지 않는다. 키·값·저장소·nonce를 함께 암호화하여 손상된 JSON, 이메일이 포함된 옛 키, Unicode도 보존한다. snapshot JSON UTF8 최대 8MiB, 키 문자열 최대 4096자다. 원문이 크기 제한을 넘으면 보존한 채 실패 처리해야 한다.

반환 `{record}`의 record는 `{envelope:{version:1,id,keyId,iv,tag,ciphertext},receipt}`다. 공개 메타에는 원래 키/저장소/작성자 정보가 없다. AES-256-GCM의 AAD가 도메인·버전·키ID·사본ID에 결합된다. seal은 자체 복호화 roundtrip 대조를 통과해야 성공한다.

`POST /api/browser-drafts/quarantine/verify` 입력은 `{record,snapshot}`이다. **immutable IDB commit 완료 후 readback한 record**와 최초 원문 snapshot을 제출해야 한다. HMAC receipt는 envelope 전체·snapshot 전체·현재 인증 subject에 결합되며, 서버는 receipt와 실제 복호화 결과의 exact 일치를 확인한다. 성공 응답은 `{verified:true,id,nonce}`뿐이다. 브라우저가 저장 완료를 실제 수행했는지는 서버가 증명하지 않으므로 commit/readback 순서는 클라이언트의 필수 책임이다. 성공 응답 재사용으로 원본 비교를 생략해서는 안 된다.

두 API는 auth+허용 workspace+trusted same-origin을 요구한다. body는 Content-Length와 무관하게 실제 스트림 24MiB로 제한된다. 모든 응답은 no-store/private이며 활동 수집에서 제외된다. 실패 응답에는 원문·키·내부 예외를 포함하지 않는다. 프록시/APM에서도 해당 경로 request body/response body 수집을 비활성화해야 한다.

sessionStorage 동기 비교 후 제거 및 localStorage 단일 탭 운영조건은 클라이언트 전환 문서를 따른다. 서버 검증 성공은 다른 옛 탭의 writer 중단 증거가 아니며 전체 브라우저 평문 0을 보장하지 않는다.

## 오프라인 복구

`scripts/recover-legacy-draft-quarantine.ts`는 HTTP와 분리된 운영자 도구다. 승인된 제한 환경에서 export한 **단일 record JSON**과 별도 보관한 격리 키를 사용한다. 파일 생성은 exclusive 및 mode 0600이며 stdout/stderr에 원문을 출력하지 않는다. 기존 출력 파일을 덮어쓰지 않는다.

```sh
node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/recover-legacy-draft-quarantine.ts /approved/input-record.json /approved/recovered-snapshot.json --authorized-offline-recovery
```

키는 승인된 비밀 주입 경로를 사용한다. CLI 플래그는 권한 검증 시스템이 아니며 운영자 승인 절차와 파일 접근 통제가 필요하다. 복구 파일은 원래 storageKey/rawValue/source/nonce를 담은 민감한 평문이므로 제한된 검토·보존·삭제 절차를 적용한다. 암호문 무결성은 AES-GCM으로 검증한다. receipt는 당시 로그인 subject에 대한 온라인 검증용이며 CLI는 작성자를 추정하거나 소유권을 부여하지 않는다. 어떤 계정으로도 자동 복원하지 않는다.

합성 테스트에서 seal→복호화 exact 보존, receipt의 계정/원문/nonce/암호문 결합, 키 회전 보존·상실 실패, 키 독립성, origin/auth/요청 크기 경계를 확인했다. 실제 사용자 사본이나 실제 비밀키를 복호화하지 않았다.

## 합성 실행 검증 기록 (2026-09-21)

- server core/API 8개 테스트 및 Next `unstable_doesMiddlewareMatch` 기반 exact matcher 회귀 1개 통과.
- `/tmp/hub-om-quarantine-next-fixture` 독립 Next 16.3.4 webpack dev 서버(41878)에 실제 route/core/proxy matcher를 복사하고 auth만 합성 workspace subject로 교체했다. 실제 환경 파일·운영 세션은 사용하지 않았다.
- 7MiB 합성 원문: seal HTTP body 7,340,194 bytes → 200/no-store. readback 형식 record + snapshot verify HTTP body 17,127,327 bytes → 200/no-store/verified:true. 따라서 기존 프록시 기본 10MiB를 넘는 검증 요청도 수정된 matcher 경로에서 통과한다. 이 증거는 독립 dev HTTP 경로이며 실제 배포 프록시 제한까지 검증한 것은 아니다.
- CLI 합성 실행: malformed JSON/Unicode 원문 exact 복구, 출력 mode 0600, stdout/stderr 원문 비노출, 기존 출력 파일 덮어쓰기 거부를 확인했다. 합성 복구 파일은 검사 후 삭제했다.
