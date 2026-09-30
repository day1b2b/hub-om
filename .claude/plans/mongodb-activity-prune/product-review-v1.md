**정적 수락 보류: P1 1건입니다.** native·audit 파일 SHA는 전달값과 일치합니다. 나머지 검토 범위에서는 추가 차단 결함을 찾지 못했습니다.

**P1 — 만료 로그 조회가 `getMore`로 넘어가면 transaction CSOT와 충돌합니다.**  
위치: [mongoActivityPruneRepository.ts:123](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoActivityPruneRepository.ts:123)

- 현재 `find().sort().limit(1000).toArray()`는 `singleBatch`·`batchSize` 지정이 없어 기본 첫 배치 이후 `getMore`가 발생합니다.
- 설치된 드라이버는 이 cursor의 `omitMaxTimeMS`를 false로 설정하면서 session의 transaction CSOT를 상속합니다. 따라서 일반 `getMore`에 `maxTimeMS`를 붙이는 기존 문제에 다시 노출됩니다.
- 결과적으로 만료 행이 첫 배치를 넘으면 정상 삭제 대신 배치가 실패할 수 있습니다. CLI는 고정 오류로 종료하고, API 자동 정리는 실패를 기록한 뒤 기존 시간당 제한 때문에 다음 정리를 기다립니다.
- 동일 저장소의 [기존 scan 구현](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoOperationStore.ts:53)은 이 문제 때문에 공개 `singleBatch`/keyset 방식을 사용합니다.

**보완:** 최대 1,000개·날짜 순서·동률 허용 의미를 유지하면서 `getMore`에 의존하지 않는 조회로 변경하십시오. 부모 native 실행에서는 101개를 넘는 경우와 999/1000/1001 경계의 실제 반환 수·잔존 전체 행을 확인해야 합니다. 단순 `maxTimeMS` 제거나 transaction 내부 `timeoutMS` 추가는 해결책이 아닙니다. **신뢰도 높음이며, 이번 검토에서 직접 재현 실행은 하지 않았습니다.**

그 외 확인한 사항은 다음과 같습니다.

- **PG 보존:** 원본 retention SQL은 변경되지 않았고, 동일 함수에 transaction timeout 10초를 적용합니다. 실제 초기화한 Prisma client만 disconnect합니다.
- **CLI 순서:** 성공 배치만 합산하며, 양쪽 모두 1,000 미만일 때 종료합니다. `writeSummary → finally close` 순서를 보존합니다. close 실패 시 이미 출력한 JSON은 남고 고정 오류로 실패합니다.
- **scope·env:** scope 누락은 env loader·DB 접근 전에 거부합니다. 명시 scope는 env를 읽지 않으며, 기본 경로만 `.env.local → .env`를 로드합니다. context 변경은 타입 슬롯 추가에 한정됩니다.
- **재시도·deadline:** deadline은 callback 밖에서 생성합니다. 시각·계수는 시도별 지역값이며, driver 오류는 `withTransaction` 밖에서 고정 오류로 변환합니다. CLI 10초, API 총 4초·개별 IO 1,500ms, cleanup 별도 제한이 구분되어 있습니다.
- **원자성·시계:** 같은 session의 snapshot transaction에서 callback마다 서버 시각을 한 번 얻고 두 삭제에 공유합니다. 두 번째 삭제 실패 시 첫 삭제도 같은 transaction에 속합니다. commit 불명을 삭제 0으로 반환하지 않습니다.
- **준비·소유권:** 기존 두 모델의 metadata와 historical policy를 모두 검사한 뒤 누락 모델을 생성합니다. 기존 모델 자동 수리·삭제는 없고, borrowed Mongo client도 닫지 않습니다.
- **API 인접 범위:** 요청 기록 후 정리, 시간당 실행 조건, 실패 후 주기, 고정 best-effort 로그 및 `recordAccess` 동작은 유지됩니다. 기존 감사 준비 범위도 축소되지 않았습니다.

파일 읽기·diff·SHA 확인만 수행했습니다. **제품 전체 실행 수락은 아직 아니며**, 위 P1 보완 후 실제 native 경계·재시도·rollback·deadline 및 변경 API 회귀 증거가 필요합니다.
