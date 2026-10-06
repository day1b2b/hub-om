**P1 정적 해소를 수락합니다. 추가 차단 결함은 발견하지 못했습니다.** 수정 후 native 실행 수락은 아직 대기입니다. 신뢰도 높음입니다.

검토한 native SHA는 `174ac4e68a4f53029c57e7ee9e75432906fcd37e76d0412e4a0a18a7e6f395cb`이며, audit SHA는 기존 `e4d1f695…02ec13`과 동일합니다.

- **조회 수정 적합:** [mongoActivityPruneRepository.ts:123](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoActivityPruneRepository.ts:123)에 `batchSize:1000`, `singleBatch:true`, `limit(1000)`이 함께 적용됐습니다. 정상 계약의 UUID·Date 두 필드만 반환하므로 1,000행은 응답 크기 한도보다 충분히 작습니다. 이 조회에 keyset을 추가할 필요는 없습니다.
- **기존 의미 유지:** 날짜 오름차순, strict `< cutoff`, 모델별 최대 1,000개, 날짜 동률의 허용 집합을 유지합니다. 반환 행의 ID·날짜·중복 검증도 남아 있습니다.
- **재시도·원자성 유지:** callback 밖의 deadline, 시도별 서버 시각·계수, 동일 transaction의 두 삭제, retry 경계 밖 고정 오류 변환은 변경되지 않았습니다. API 총 4초·개별 IO 1,500ms와 CLI 10초도 유지됩니다.
- **CLI·PG·scope 유지:** 원본 PG retention 함수와 10초 transaction, 성공 합계 출력 후 `finally close`, close 실패 시 기출력 JSON 보존, 누락 scope의 env·DB 접근 전 거부, 명시 scope의 env 접근0을 재확인했습니다.
- **준비·인접 범위 유지:** 기존 모델 선검증 후 누락 모델 준비, borrowed client 미종료, 감사 기록 후 best-effort 정리 및 기존 시간당 제한은 유지됩니다.

**native 관찰 시 한 가지 주의점이 있습니다.** 설치된 드라이버는 `batchSize === limit`이면 실제 find 명령의 `batchSize`를 **1001**로 바꿉니다. `limit:1000`과 `singleBatch:true`는 그대로이므로 제품 결함이 아닙니다. wire 단언에서 `batchSize===1000`을 강제하면 정상 구현을 잘못 실패시킵니다. 실제 최대 반환 1,000개와 `getMore=0`을 기준으로 판단해야 합니다.

남은 실행 확인은 요청하신 999/1000/1001의 삭제 수·전체 raw 잔존 집합·`getMore=0`, 그리고 기존 native retry·rollback·deadline 검증입니다. API 12PASS와 command 20PASS는 현재 **부모 실행 보고**로 구분하며, 이번 검토에서 로그를 독립 수락하지 않았습니다.

파일 읽기와 SHA·diff 확인만 수행했습니다. DB·테스트 실행 및 파일 수정은 하지 않았습니다.
