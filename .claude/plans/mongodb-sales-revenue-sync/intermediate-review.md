**확정할 제품 P0–P2 결함은 발견하지 못했습니다. 다만 중요한 테스트 공백 2건이 남습니다.** 정적 검토 기준 신뢰도는 중간입니다.

::code-comment{title="[P2] 재시도 전체 120초 제한 검증 누락" body="현재 시험은 실제 오류 112와 재시도 성공을 확인하지만 전체 deadline 소진은 검증하지 않습니다. 실제 충돌 전후 가상 시간을 누적해 120초를 넘기는 사례를 추가하고, 먼저 커밋한 수동 변경은 유지하면서 동기화 업무·감사는 롤백되고 sync log는 생성되지 않는지 원시 문서로 비교해야 합니다. 재시도마다 제한시간을 초기화하는 회귀를 현재 시험으로는 잡지 못합니다." file="/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoSalesRevenueSync.integration.test.ts" start=166 end=177 priority=2}

::code-comment{title="[P2] 조회 후 revenue/raw 모두 목표값인 경합 사례 누락" body="already-target은 관리자 revenue만 바꾸므로 raw 변경 감사 1건만 검증합니다. 별도의 updatedAt-only 시험은 repository 직접 호출이어서 workflow가 pending을 재계산해 제거하는 회귀를 잡지 못합니다. 최초 listCourses 이후 revenue와 revenueRaw를 모두 목표값으로 맞춘 뒤, 응답 before=10·changed=1·updatedRows=1은 유지되고 해당 요청의 변경감사는 0건인지 검증하는 사례가 필요합니다." file="/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoSalesRevenueSync.integration.test.ts" start=190 end=210 priority=2}

확인한 구현은 다음과 같습니다.

- 업무와 감사가 같은 세션에서 처리되고, 재시도마다 최신 행을 읽습니다.
- `$set`은 `revenue/revenueRaw/updatedAt`만 포함합니다.
- 비유한 금액은 `null`과 `String(number)`로 저장합니다.
- 누락 키의 쓰기 0회 기대는 PG 초기화 검사와 부합합니다.
- 읽기 전용 시험은 실제 네 컬렉션의 원시 문서를 전후 비교합니다. 다만 **동시 변경 중 Course/Company가 같은 조회 스냅샷을 사용하는지**까지 입증하는 시험은 아닙니다.

파일 수정, DB·테스트 실행, 타입 검사 모두 하지 않았습니다.
