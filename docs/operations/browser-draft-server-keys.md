# 브라우저 초안 서버 키

별도 잠금 암호 없이 기존 Google Workspace 로그인으로 브라우저 초안 키를 받는다. 키를 받으려면 온라인 인증이 필요하다. 새로고침·브라우저 재시작으로 메모리 키를 잃은 상태에서는 서버 장애 중 자동 복구할 수 없다. 이 절충은 브라우저에 복호화 키를 영구 저장하지 않기 위한 것이다.

## 서버 설정

`BROWSER_DRAFT_MASTER_KEYS`는 키 ID에서 표준 base64 32바이트 키로 매핑하는 JSON 객체이며 1~8개를 지원한다. `BROWSER_DRAFT_ACTIVE_KEY_ID`는 신규 암호화에 쓸 키 ID다. `BROWSER_DRAFT_OWNER_KEY`는 암호화 master와 별개인 32바이트 키이며 보관함 소유자 ID를 안정적으로 파생하므로 유지해야 한다. 모두 서버 런타임 secret으로만 주입하고 `NEXT_PUBLIC_`, Git, 로그에 넣지 않는다.

모든 키는 안전한 난수로 독립 생성해야 한다. 형식 검증은 난수 품질을 입증하지 않는다. 구현은 owner/master 간 중복, master 간 중복 및 설정된 `AUTH_SECRET`(번호를 붙인 회전 키 포함), `NEXTAUTH_SECRET`, `PII_INDEX_KEY`, `PII_ENCRYPTION_KEYS`와의 동일 키 재사용을 거부한다. 인증 키나 DB 개인정보 암호화 키를 전용 master로 대신 사용하지 않는다. 실제 키 생성·주입·배포는 이 구현 작업에서 수행하지 않았다.

서버는 인증된 `google:<providerAccountId>`를 기준으로 전용 master와 HKDF-SHA256을 사용해 32바이트 AES 키를 파생한다. HKDF의 info는 용도·키 ID·subject를 모호하지 않은 JSON 배열로 구분한다. 별도 OWNER_KEY와 HMAC-SHA256으로 opaque owner ID를 만든다. 계정마다 키가 분리되며 암호화 master를 추가해도 owner ID는 바뀌지 않는다. 계정별 난수 키를 DB에 저장하는 대안과 달리 새 스키마를 필요로 하지 않지만, master 유출 시 해당 master에서 파생되는 모든 계정의 초안 키가 영향을 받는다.

## API 계약

`POST /api/browser-drafts/keyring`은 본문을 사용하지 않고 현재 인증 세션만 조회한다. Origin은 서버의 `BROWSER_DRAFT_APP_ORIGIN` 설정(예: `https://<공개 앱 호스트>`)과 정확히 일치해야 하며, 전용 설정이 비어 있으면 명시적인 `AUTH_URL`의 origin을 사용한다. 기존 알림 링크에서도 사용하는 `AUTH_URL`을 활용하되 기본 배포 주소를 추측해서 허용하지 않는다. Coolify standalone의 내부 요청 URL이 `http://0.0.0.0:3000`이어도 설정된 외부 HTTPS Origin을 검사한다. 운영 환경에 두 설정이 모두 없거나 값이 잘못됐거나 HTTPS가 아니면 인증 처리 전 503으로 중단한다. 개발·테스트 환경에서만 두 설정이 없을 때 요청 URL의 origin을 사용한다. 전용 설정은 경로·쿼리·fragment·계정 정보를 포함하지 않는 origin이어야 한다. cross-site 요청과 다른 Origin은 거부하며, 외부의 `Forwarded`/`X-Forwarded-*` 헤더로 허용 origin을 바꾸지 않는다.

응답 형식은 `{version: 1, subject, ownerId, activeKeyId, keys: [{keyId, keyBase64}]}`다. 원본 master/OWNER_KEY는 응답하지 않는다. `subject`는 비동기 계정 전환 뒤 잘못된 키 응답을 적용하지 않도록 현재 세션과 비교하는 용도이며 클라이언트에 평문으로 영구 저장하지 않는다. 신규 등록의 기대 계정(expectedSubject)은 재개 요청 검증을 위해 암호문 내부에 포함한다. 공개 subject와 요청 헤더는 인증 수단이 아니라 서버가 인증한 세션과 일치하는지 추가로 검사하는 값이다. 키도 메모리에만 유지하고 Web Crypto로 가져온 뒤 raw 문자열 참조를 버린다. 서비스 워커/Cache Storage/IndexedDB/localStorage/sessionStorage/분석 도구에 이 응답을 저장하지 않는다.

모든 handler 응답은 `Cache-Control: no-store, private, max-age=0`을 포함하며 CORS 허용 헤더를 제공하지 않는다. 현재 세션이 없거나 허용 Workspace 계정이 아니면 401, Origin 위반은 403, 기존 세션에 Google subject가 없으면 409(`reauthentication_required`), 키 설정이나 인증 처리 실패는 503이다. handler는 개발용 인증 우회도 사용하지 않으며 activity 기록 wrapper로 키 응답을 감싸지 않는다. 프록시 인증 계층은 이 API를 handler의 명시적 401 판정에 맡겨 로그인 리다이렉트로 바꾸지 않아야 한다.

## 회전·복구 및 미검증

새 master는 새 ID로 추가하고 active ID만 바꾼다. 기존 ID의 값을 바꾸거나 이름을 바꾸면 해당 ID의 과거 초안을 복호화하지 못한다. 과거 master 삭제는 모든 관련 브라우저 초안의 재암호화·보존 정책을 확인한 후에만 가능하다. 최대 8개 제한에 도달했다고 임의로 오래된 키를 지우면 안 된다. OWNER_KEY 변경은 기존 보관함 주소를 바꾸므로 별도 이관 설계가 필요하다. 전용 키의 안전한 백업·복구 책임자와 보관 정책은 배포 전 확정한다.

서버는 Google provider subject를 세션에 저장해 사용하고 이메일로 대체하지 않는다. 과거 세션은 재로그인이 필요하다. subject와 별개로 Workspace 이메일 허용 여부도 확인한다. 기존 세션 자체의 유효성·퇴사자 회수 시점은 기존 인증 체계에 의존한다.

단위 테스트는 계정 분리, 회전 시 과거 키 유지, 전용 키 재사용 거부, Origin 차단, 401/409/503 응답, no-store를 합성 값으로 검증한다. 내부 요청 URL과 외부 Origin의 조합은 단위 fixture로 검증하지만 실제 OAuth·역방향 프록시 배포·브라우저 키 수령·비밀 설정·운영 회전/복구는 이 서버 단위 테스트만으로 검증되지 않는다. HTTPS 배포, 로그/응답 수집 차단, 클라이언트 메모리 수명 및 기존 평문 이관은 통합 검증 대상이다. XSS나 동일 origin의 악성 코드가 실행 중 메모리 키를 사용하는 공격은 이 저장 암호화로 막지 못한다.
