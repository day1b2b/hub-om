**9개 로컬 runtime 의존성을 git object로 동결하는 방식이 가장 작고 안전합니다.** 현재 계획은 `clarify-result.md`·`plan-v1.md`이며 v2는 아직 없습니다.

- **동결 범위:** health route, `prisma.ts`, `dataRepositoryContext.ts`, privacy의 `crypto/database/fields.ts/fields.json`, activity의 `database/context.ts`. 기준은 `35104776c1ae4f42696d06e0e836ead29a786fb3`. type-only import 때문에 다른 업무 모듈까지 복제하지 않습니다.
- **두 방식 비교:** 원본 사본은 검토가 쉽지만 중복·실명 복제 위험이 있습니다. **git blob/SHA resolver를 권장**합니다. 변경 없는 의존성을 현재 파일에서 읽는 방식도 가능하지만 매번 baseline hash 일치를 강제해야 합니다. 변경 예정인 context를 무검증 공유하면 원본 오염입니다.
- **실제 라이브러리 유지:** `NextResponse`, Prisma client/adapter, `pg`는 실제 설치본을 사용합니다. package/lock·schema·실제 loader 및 사용 패키지 버전을 기록합니다. 원본과 current는 별도 process로 실행해 `globalThis.prisma`·scope cache를 분리합니다.

최소 실제 PG 사례는 다음이면 충분합니다.

| 사례 | 실제 route에서 확인 |
|---|---|
| 유효한 임시키 + 새 PG56754 | 실제 `SELECT 1`, 200·전체 JSON·content-type·`force-dynamic` |
| 같은 소유 endpoint의 종료 확인 후 호출 | 실제 연결 실패, production 503·고정 전체 JSON |
| 잘못된 키 **형식** + 정상 PG 주소 | 실제 privacy guard 거부, 연결/쿼리0, production 503 |
| 명시 빈 scope + 잘못된 키 | 실제 scope guard가 먼저 거부, PG fallback0 |
| nonproduction 키 형식 오류 | 원본 상세 오류와 새 고정 오류를 **의도적 차이**로 기록 |

핵심 주의점은 **형식이 유효한 다른 키는 `SELECT 1`에서 실패하지 않는다는 것**입니다. 암호문을 읽지 않으므로 키 정확성·schema readiness 증거로 확대하면 안 됩니다. 성공 사례도 빈 PG DB로 충분하며 업무 seed·migration은 불필요합니다.

관찰자는 실제 연결·쿼리에 위임하고 반환값을 대체하지 않습니다. 원본 byte 변조·current import 탈출 음성대조만 추가하면 됩니다. 파일 변경·DB·테스트 실행은 하지 않았습니다.
