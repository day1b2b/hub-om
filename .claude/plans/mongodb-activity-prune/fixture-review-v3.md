**PG fixture 최종 수락은 출력 parser 결함 1건 때문에 보류합니다.** 나머지 원본 격리·실제 PG 관찰·삭제 집합·정리 설계에서는 추가 차단 결함을 발견하지 못했습니다. `source-digests.json`의 **9개 파일 hash는 모두 일치**합니다.

### 수정 필요

**[P2] 설치된 dotenv 출력 형식과 parser가 불일치합니다.**  
[subprocess.fixture.ts:56](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/activity-prune-tests/subprocess.fixture.ts:56)

PG parser는 `[dotenv@버전] injected env ...`만 허용하지만, 설치된 [dotenv 구현](/Users/ga/workspace/hub-om-mongodb-coach-content/node_modules/dotenv/lib/main.js:130)은 `◇ injected env ...`를 출력합니다. 정상 CLI도 `PRUNE_UNKNOWN_STDOUT`으로 실패할 수 있습니다. 제품 실패와 구분해야 합니다.

최소 보완:

- 설치 버전의 `◇` 형식과 기존 8개 tip literal을 정확히 허용합니다.
- 이 PG fixture의 env 우선순위 사례별 예상 안내문을 사용합니다. Carver fixture의 주입 개수를 그대로 복사하면 안 됩니다.
- 동일 parser에 미등록 tip·suffix·추가/누락 안내문 음성대조를 연결합니다. 현재 `.filter(Boolean)`은 추가 빈 줄을 숨기므로 출력 검증 강도를 함께 정리하는 편이 좋습니다.
- 보완 후 source digest를 갱신하고 부모가 재실행합니다.

### 정적으로 확인한 적절한 부분

- **원본 독립성:** 기준 Git blob 기반 runtime 10개·support 4개, 의존성 허용 목록, manifest 대조, byte 변조·현재 코드 탈출 음성대조가 연결됐습니다. 원본/current는 별도 subprocess입니다.
- **실제 I/O:** CLI observer는 정상 SQL을 실제 driver에 위임합니다. 두 DELETE 직전 같은 client에서 `now()`·transaction ID·PID를 관찰하며, 부모가 일치 여부를 검사합니다.
- **원자성·부분 commit:** 두 번째 DELETE 위치의 실제 PG CAST 오류 주입으로 첫 배치 rollback과 후속 배치 실패를 구분합니다. 계수뿐 아니라 실패 직후 전체 raw 잔존 집합을 검사한 뒤 recovery를 수행합니다.
- **전체 행 검증:** 독립 ID 기대 집합, 중복 검출, 생존 행 전체 필드·암호문 불변 검사가 있습니다. 동률은 특정 ID를 강제하지 않습니다.
- **정밀도:** PG microsecond를 보존해 밀리초 경계의 기대 삭제 수를 계산합니다. `exactEqualityObserved=false`일 때 정확한 동률 실행 증거로 주장하지 않는 한계 표시가 적절합니다.
- **종료·정리:** 실제 socket close를 기다리고, 강제 종료 시 후속 실행과 자동 행 정리를 중단해 부모 자원 감사를 요구합니다. 정상 정리는 미리 소유한 ID만 삭제하고 전체 잔존 0을 확인합니다.
- **오류 구분:** 실제 연결 종료 후 close 오류 주입이라는 점을 명시했습니다. 원본 traceback은 raw 저장 없이 hash로 남기고 current 고정 오류는 별도로 검사합니다.

### 현재 수락 범위

- **Command:** 이전 P2의 정적 종결 유지. `21 PASS`는 부모 전달 결과입니다.
- **Native:** 수정된 quiescence 필터의 정적 수락 유지. `native-fixed 12 PASS`는 부모 전달 결과입니다.
- **API 회귀:** `api-final 12 PASS`는 부모 전달 결과이며 이번에 로그를 독립 확인하지 않았습니다.
- **PG:** 위 parser 보완 및 완료 로그 확인 전까지 실행 수락 보류입니다.
- **전체 scope:** 일반·타입·lint 등 최종 결과가 진행 중이므로 완료 수락은 아직 아닙니다.

파일 수정·DB 접속·테스트 실행은 하지 않았으며, 새 기능 조사도 시작하지 않았습니다.
