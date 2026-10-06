**메타 판정: 구현 대기 유지. S1/S2는 충족하지만, S3 필수 5개와 아래 검증 보완을 계획·validation에 반영한 뒤 구조 재수락이 필요합니다.** 역사 PG의 실행 가능성은 아직 NOT_RUN이며, 실제 gate 결과 없이 수락할 수 없습니다. 확신도 높음.

기존 S3 보완 5개는 원본 코드와 일치합니다: evidence만 기본값 적용, concurrency0.5→worker0, try 밖 link 선택 실패, commit 후 성공/error 결과 공존, `Promise.all`의 비취소 의미입니다. 특히 [plan-v1:21](/Users/ga/workspace/hub-om-mongodb-coach-content/.claude/plans/mongodb-drive-import-writer/plan-v1.md:21)의 confidence 기본값 문구는 반드시 수정해야 합니다.

추가 반영할 사항은 다음과 같습니다.

1. **P2 — prefix18 gate가 validation에서 빠져 있습니다.**
   [validation-v1:29](/Users/ga/workspace/hub-om-mongodb-coach-content/.claude/plans/mongodb-drive-import-writer/validation-v1.md:29)와 V1은 역사 기능/current 차단만 분리합니다. 조사에서 확정한 세 gate를 명시하세요.

   - prefix17: 실제 default/FK/컬럼 확인 후 원본 기능 실행.
   - prefix18: 실제 guard 통과·대상 조회 후 `createRun`에서 **SQLSTATE23502**, source0·run/result0.
   - current45: 실제 guard 차단, 대상 조회0·source0·쓰기 시도0.

   각기 별도 DB와 원문 migration prefix 해시를 사용하고, 어느 gate든 예상과 다르면 구현을 중단하도록 연결해야 합니다.

2. **P2 — 날짜와 enum의 비교 규칙을 사전 고정해야 합니다.**
   [validation-v1:111](/Users/ga/workspace/hub-om-mongodb-coach-content/.claude/plans/mongodb-drive-import-writer/validation-v1.md:111)의 “원본 dateOnly 의미”만으로는 부족합니다. UTC와 Asia/Seoul의 별도 worker에서 **PG DATE 원값→driver 반환 타입/값→dateOnly→source 입력→저장 날짜**를 관찰하고 같은 TZ끼리 비교하도록 명시하세요. 업무 날짜의 하루 차이를 생성 시각 정규화에 포함하면 안 됩니다.

   원본 SQL status 소문자와 Prisma enum 대문자도 [260행](/Users/ga/workspace/hub-om-mongodb-coach-content/.claude/plans/mongodb-drive-import-writer/validation-v1.md:260)의 “ID·시간만 정규화”와 충돌할 수 있습니다. raw 저장 표현은 보존하고, enum으로 확인된 필드에만 명시적 logical 대응을 적용하세요. NOT NULL인 운영 날짜의 null 사례는 정상 PG fixture로 만들지 말고, nullable 결과 날짜와 구분해야 합니다.

3. **P2 — prepare의 선검증 순서를 실패 변별 사례로 고정해야 합니다.**
   [validation-v1:287](/Users/ga/workspace/hub-om-mongodb-coach-content/.claude/plans/mongodb-drive-import-writer/validation-v1.md:287) 이후에 다음을 추가하세요.

   > “5모델 중 누락 모델과 잘못된 기존 모델이 함께 있으면, 기존 모델 전체 검증 실패 전에 collection/index/validator 생성·변경이 없어야 한다.”

   metadata 오류와 **정상 metadata 아래 historical invalid document**를 분리하고, 후자는 raw 보존·prepare 거부를 확인해야 합니다. crypto/HMAC 인증 실패는 이 정책 검증과 별도입니다. 기존 namespace 자동수리 금지라는 문구만으로는 조기 부분 준비를 잡지 못합니다.

4. **P2 — snapshot/FK 범위와 감사 기준이 조사 수준에 머물러 있습니다.**
   [validation-v1:104](/Users/ga/workspace/hub-om-mongodb-coach-content/.claude/plans/mongodb-drive-import-writer/validation-v1.md:104) 및 V5에 다음을 연결하세요.

   - loadOperations의 join·정렬·limit은 한 snapshot에서 판정.
   - 부모 run 없음, non-null operationSession 참조 없음, 기존 soft-delete 상태를 구분.
   - load 후 기존 soft-delete writer와 append가 겹쳐도 기존 snapshot 값을 현재 업무값으로 덮어쓰지 않음.
   - **물리삭제와 동시 CASCADE/SET NULL 동등성은 이번 수락 대상이 아님**을 명시.
   - activity context 없는 CLI에서 ActivityRequest/ActivityChange 추가 쓰기0을 전후 상태로 확인.

   새 삭제 lock이나 전역 FK 보장을 요구할 필요는 없습니다.

5. **P2 — 결정적인 fault 결과와 harness 오류를 분리해야 합니다.**
   [validation-v1:222](/Users/ga/workspace/hub-om-mongodb-drive-import-writer/validation-v1.md:222)의 “error result도 저장 가능”은 허용 결과가 너무 넓습니다. **첫 append commit 성공을 확인한 뒤 한 번 오류를 주입하고 catch append는 성공시키는 사례**라면, 원본 관찰을 거쳐 성공/error **정확히 2행**, source1회, errors1 및 기존 증가 집계 유지로 고정하세요. create/finish의 commit 후 오류도 독립 조회와 주입 도달 횟수를 요구해야 합니다.

   또한 transport/DB 관찰 assertion이 workflow catch에 잡혀 정상 error result로 바뀌면 거짓 통과할 수 있습니다. 계약 위반을 별도로 누적하고 workflow 밖에서 위반0을 검사하며, 의도적 fault와 구분하는 음성대조를 추가하세요.

나머지 설계는 적절합니다. 독립 literal·전집합 ID/FK 대조·후보 경계 음성대조는 거짓 성공을 줄이고, issues-only 완료·부분쓰기·worker0·병렬 완료 순서의 구분은 거짓 실패를 방지합니다. 기존 UI/Calendar 전체 반복, 전체 실행 transaction, source retry, 전역 exactly-once를 추가할 이유는 없습니다.

`warning`: 실 Google·운영 collation·미확인 예약 실행·snapshot 개인정보 분류·백업/복원·전체 cutover는 계속 별도 미완료 gate로 유지해야 합니다.

파일 수정·DB/테스트 실행·새 산출물 생성은 하지 않았습니다.
