# dev 정합 실행 기록

2026-09-30 재개. 기준 dc39e19 + dev307f52f의 일반 병합 상태에서 실행한다. 이전 중지 기록은 `/Users/ga/.cache/hub-om-verification/20260930-dev-alignment-paused`에 보존했다.

## 확인한 결과

- 새 loopback PG17.9/Mongo8.0.30 replica set, Node24.19.0, env-i, 합성 데이터·임시 키만 사용했다.
- `metadata-native.log`: 실제 Mongo operation 파일 17 pass / 0 skip / 0 fail, exit0. 새 생성시각 exact 조회, 누락/null, soft-delete 포함, 관계 없이 좁은 projection, 조회 부수 쓰기 없음.
- `pg-parity.log`: 기존 OM 원본PG/newPG/Mongo 회귀 56 pass / 0 skip / 0 fail, exit0. 45 migrations 포함. 이 묶음은 새 생성시각 메서드의 직접 PG 대조가 아니다.
- `unit.log`: 920 pass / 65 skip / 0 fail. DB opt-in 없는 일반 실행이며 skip을 통과로 세지 않는다.
- `typecheck-final.log`: exit0. `lint.log`: 오류0, 기존 경고7.
- `build.log`: exit0. 전체 Mongo(`mongo-bundle.log`): 705 pass / 0 skip / 0 fail, exit0. 기존 mock4 포함. 새 만족도 실제 POST 묶음9, metadata 추가1 및 이전 OM 보완11사례가 포함된다. 이전684와 단순 독립합산하지 않는다.
- `cleanup.log`: exit0. 소유 PG public schema 비움/Mongo 사용자 DB0 확인 후 종료, 정확한 두 dbpath 제거, loopback56719/27819 닫힘 확인.
- 실행 원본과 실행/정리 스크립트를 `/Users/ga/.cache/hub-om-verification/20260930-dev-alignment`에 보존했다. 최종 독립 수락 및 merge commit/push는 integration-review를 따른다.

새 만족도 테스트는 실제 POST·withActivity·Mongo operations/requestActivity를 사용한다. auth supplier·PG fallback 감지·외부 fetch 감지는 mock이며 실제 인증 공급자/Google 연동 검증이 아니다. 새 metadata와 만족도는 전체 Mongo 묶음과 중복 합산하지 않는다.

실제 백업/키 복구/운영 데이터 복사/외부 원천/배포는 미실행. 운영 백업 확인 증거0건. 이중 백업 계획은 실행 결과가 아니다.

## 조사 중 명령 오류

import 경로 조사에서 존재하지 않는 `importRepositoryFactory.ts` 및 `privacy/fields.json`/`mongoRuntimeContracts.ts` 위치를 지정한 읽기 명령이 실패했다. `rg --files`와 실제 참조 검색으로 `src/lib/privacy/fields.json` 및 `mongoRuntimeCodec.ts`를 확인했다. 제품·검증 실패가 아니며 원천/DB 접근은 없었다.
