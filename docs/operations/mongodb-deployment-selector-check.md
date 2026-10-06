# Mongo 배포 selector 사전 점검

앱에는 35개의 기능군별 backend selector가 있다. `.env.example`은 모두 `postgres`로 명시해 기존 운영 기본값을 유지하며 `MONGODB_SHADOW_NAMESPACE`도 빈 값으로 둔다. 코드의 production composition selector와 예시 목록은 테스트가 자동 대조한다.

배포 환경 파일을 명시적으로 주입한 격리 환경에서 다음 정적 점검을 실행할 수 있다.

```bash
node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/check-mongodb-deployment.ts --expect=postgres-legacy-pii
node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/check-mongodb-deployment.ts --expect=postgres
node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/check-mongodb-deployment.ts --expect=mongodb-shadow
```

`postgres-legacy-pii`는 모든 selector가 비어 있거나 정확히 `postgres`이고 `PII_ALLOW_PLAINTEXT_READS=true`인지 확인한다. 운영 PostgreSQL에 평문 개인정보가 남은 동안의 정상 서비스·복구 배포에는 반드시 이 모드를 사용한다. `postgres` 기대 모드는 selector만 확인하므로 개인정보 상태를 모르는 운영 배포의 안전 판정에 사용하지 않는다. `mongodb-shadow` 기대 모드는 35개가 모두 정확히 `mongodb-shadow`이고, shadow namespace·Mongo URI/database·개인정보 키가 유효하며 `PII_ALLOW_PLAINTEXT_READS=false`, `RUN_DB_MIGRATIONS=true`가 아님을 확인한다. 일부 기능만 바뀌거나 알 수 없는 값이 있으면 고정 오류로 실패한다.

`postgres-legacy-pii`는 평문이 실제로 남았는지를 판정하지 않는다. 운영 데이터 상태는 `scripts/encrypt-personal-data.ts`의 읽기 전용 점검으로 별도 확인한다. 점검에서 모든 `plaintext`와 `invalidIndexes`가 0이 되기 전에는 `PII_ALLOW_PLAINTEXT_READS=false`로 바꾸지 않는다.

이 명령은 PostgreSQL·MongoDB·외부 원천에 연결하지 않고 실제 namespace readiness, 데이터 복사, 권한, A/B 백업·복원, 예약 작업과 Coolify 설정을 검증하지 않는다. 따라서 통과 결과만으로 운영 전환을 승인하거나 selector 값을 바꾸면 안 된다.
