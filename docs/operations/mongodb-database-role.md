# MongoDB DB 역할 구분

운영 DB와 테스트 DB를 코드에서 명시적으로 구분하기 위한 계약이다. 이 문서는 코드 준비 단계이며, 운영 DB 전환이나 데이터 이전 완료를 뜻하지 않는다.

## `MONGODB_DATABASE_ROLE`

| 값 | 허용 DB | 비고 |
|---|---|---|
| (빈 값) | `hub-om-shadow-validation`, `hub_om_shadow_[a-z0-9_]{1,40}` | 기존 동작 그대로. 현재 컨테이너는 값을 바꾸지 않아도 된다 |
| `production` | `hub-om`, `hub-om-shadow-validation` | `hub-om`이 목표 운영 DB, `hub-om-shadow-validation`은 전환 전 현재 운영 DB |
| `test` | `hub_om_shadow_[a-z0-9_]{1,40}`만 | 운영 DB를 지정하면 `PRODUCTION_DATABASE_REJECTED_FOR_TEST`로 실패 |

그 밖의 값은 `MONGODB_DATABASE_ROLE_INVALID`로 실패한다. 대소문자도 정확히 맞아야 한다.

테스트 도구는 env와 상관없이 `assertTestMongoDatabase(name)`로 대상 DB를 확인할 수 있다.

## 주의

- 역할 구분은 실수 방지용이다. 계정 권한 분리(운영 계정은 운영 DB만, 테스트 계정은 테스트 DB만)를 대신하지 않는다.
- `hub-om`으로 전환하는 일은 백업·복원 검증, 데이터 이전, 최종 동기화를 마친 뒤 별도 승인으로 진행한다.
