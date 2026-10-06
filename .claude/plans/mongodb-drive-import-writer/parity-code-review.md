**source harness 3건 수정 후 freeze했습니다.**

- timeout/signal 발생 시 바깥 suite 루프도 중단해 후속 사례 실행을 막습니다.
- `exit` 대신 `close` 후 stdout/stderr를 검사합니다.
- 실패 IPC는 고정 코드와 단계만 전달합니다. 부모도 임의 report/error 내용을 출력하지 않습니다.

변경 파일은 [통합 테스트](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/driveImportWriterSource.integration.test.ts), [Child fixture](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/driveImportWriterSourceChild.fixture.ts)뿐입니다. 제품 변경·DB·테스트 실행은 없으며, 부모의 V3 재실행을 기다립니다.

**읽기 전용 parity 검토 결과도 유지합니다 — P2 3건:**

1. 이전 run/result는 이후 ID 집합만 검사하므로, 동일 ID의 내용 변조를 놓칩니다. 최종 recovery 후 전체 tuple 재대조가 필요합니다.
2. `console.error` 인자를 버리고 stderr는 hash·크기만 기록하므로, 원문 출력 회귀를 놓칩니다. current/native 로그 검사와 출력 음성대조가 필요합니다.
3. `MongoDbNull`과 `MongoJsonNull`을 모두 `null`로 정규화해 pending summary의 저장 의미 차이를 숨깁니다. 정규화 전 단언 또는 기존 transaction 증거 연결이 필요합니다.

원본 resolver 분리, 제품 expected helper 미사용, source 계약 위반의 catch 밖 단언은 확인했습니다. parity 파일은 수정하지 않았으며 전체 역사/Mongo 재실행을 요구하지 않습니다.
