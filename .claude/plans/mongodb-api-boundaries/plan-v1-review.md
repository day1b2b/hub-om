# 독립 계획 검토 (v2 반영)

판정: 구조 S1–S3와 계획 승인 조건 통과. 검토 기준은 plan-v2/validation-v2이며 결과 검증 통과를 뜻하지 않는다. 실행 증거가 없는 항목은 후속 execution-review에서 pending으로 유지한다.

## 결정성·변별력·추적성

Core 1은 실제 Coach 두 route·Team facade·Instructor factory, Core 2는 global ALS와 cached PG 차단, Core 3은 request/PII 감사의 서로 다른 실패 의미, Core 4는 transaction 변경 감사를 구체적으로 정한다. 각 항목이 validation 1–10의 성공·실패 사례로 연결된다. Shell의 명시 shadow 준비와 자동 backend 선택 금지는 11–15에서 확인한다.

실제 운영 전체를 한 번에 전환하는 대안보다 요청 scope로 기존 PG 기본값을 보존하는 접근이 현재 검증 범위에 적합하다. 비용은 미전환 직접 PG 경로가 shadow에서 실패한다는 점이며, 이를 fallback으로 숨기지 않고 gap으로 관리한다. getter guard만으로 이미 외부에 보관된 Prisma instance까지 강제로 무효화하지는 못하므로 현재 코드의 연결 취득 위치와 반례를 확인해야 한다.

## 반드시 실행에서 구분할 사항

- V1–3: adapter 단독 테스트 대신 기존 export route/facade 호출을 통해 provider가 실제 사용되는지 확인한다. 실제 PG query 대조를 하지 않으면 그 한계도 남긴다.
- V4–6: 실제 session guard를 유지하고 context actor는 권한을 부여하지 않는다. 병렬·중첩·throw 이후 scope 복원을 검증한다.
- V7–8: recorder 누락은 handler 이전 실패, recorder runtime 실패는 이미 성공한 업무 응답을 보존하는 best-effort다. DATABASE_URL 없음과 캐시된 PG가 있는 경우를 각각 검사하고 PG 호출 0회를 확인한다.
- V9: 개인정보 서비스는 권한→접근 감사→조회 순서를 지킨다. 감사 실패에서 개인정보 조회조차 일어나지 않아야 한다. 실제 export route는 별도 직접 PG 경로라는 gap을 남긴다.
- V10: request 감사는 업무 transaction 밖이고 mutation 감사는 안이다. 두 계약을 혼동하지 않는다. Coach join 제거·추가/복합 PK/private profile PK, Team 배치, Instructor 부분 수정에서 실패 주입과 실제 rollback이 필요하다. EDIT_HISTORY는 내용 기록만 남기고 중복 ActivityChange는 제외한다.
- V11–15: 실제 합성 Mongo8 결과를 기록하되 운영 cluster·실데이터·전환 완료로 확대하지 않는다. 전체 테스트 생략과 단위/mock/native 증거를 따로 기록한다.

추가 차단 계획 충돌은 발견하지 않았다. 실제 route 코드와 native 실패 주입 결과를 읽은 후 실행 판단을 별도로 작성한다. 이번 검토는 제품 코드·운영 데이터·키를 변경하지 않았다.
