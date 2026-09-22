# Meta evaluation

독립 sql_review 기준은 정책·경계·경쟁·실패·보안으로 나눠 test assertion에 연결 가능. 단순파일존재/통과개수는 결과판정 대체불가. 중요한 반례: 다른coach 예약도 confirmed ID FK상 유효, 삭제전 그coach guard포함 필요. mock은PG실경합증거아님. 기존findFirst 정렬 우선순위보장없음. 이름유일성 새정책금지.

기존코치 public/private 보충을 한tx로 묶는 것은 의도적 원자성 강화이며 완전히동일한부분실패라고 주장하지않는다. 세부테스트와 미검증한계 명시 조건으로 기준채택.
