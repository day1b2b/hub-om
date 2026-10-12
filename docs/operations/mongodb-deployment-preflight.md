# MongoDB 배포 전 독립 검사

`npm run mongodb:check-deployment`는 현재 프로세스에 전달된 환경변수만 정적으로 검사한다.

- 서버를 시작·중지·재시작하지 않는다.
- PostgreSQL과 MongoDB에 연결하지 않는다.
- 데이터를 읽거나 쓰지 않는다.
- Slack·Calendar 등 외부 연동을 실행하지 않는다.
- 모든 `*_BACKEND` 값이 `postgres` 또는 `mongodb-shadow`인지 확인한다.
- 일부 기능만 MongoDB를 사용하는 단계별 전환 조합도 허용한다.
- MongoDB selector가 하나라도 있으면 URI 형식, 대상 DB·namespace, 개인정보 키 분리, 평문 읽기 차단, PostgreSQL migration 비활성화를 확인한다.
- 성공·실패 출력에는 비밀값을 포함하지 않는다.

운영 배포 전에 기존 서버와 분리된 일회성 프로세스에서 실행한다. 실패하면 배포를 시작하지 않고 현재 서버를 유지한다. 이 명령을 앱의 `ENTRYPOINT`, `/api/health`, 컨테이너 재시작 정책에 연결하지 않는다.

성공 출력 예:

```json
{"readyFor":"runtime","selectorCount":35,"mongoSelectorCount":2}
```

실패 출력은 아래 고정 코드만 사용한다.

```json
{"readyFor":false,"code":"MONGODB_DEPLOYMENT_CONFIGURATION_INVALID"}
```
