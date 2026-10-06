# Gap plan

독립 구현 검토에서 제품 P1/P2는 발견하지 않았다. 아래는 validation-v2 대비 실행 증거 부족이므로 통과 기준을 완화하지 않고 보완한다.

1. 실제 guard 경합에서 양 순서를 각각 강제한다. driver 호출 직후 barrier/실제 write conflict 관찰로 선행 transaction을 고정하고 같은 실제 handler의 결과를 검증한다.
2. guard 문서가 없는 최초 동시 upsert와 재시도를 검증한다.
3. engagement 조회 후 guard conflict가 발생했을 때 전체 callback 재조회로 두 번 toggle 원상복귀 및 부분 수정 병합을 보장하는지 native로 확인한다.

모의 DB 결과로 대체하지 않는다. 모든 barrier는 finally에서 해제하고 pending request를 수거한 다음 restore/합성DB cleanup한다.
