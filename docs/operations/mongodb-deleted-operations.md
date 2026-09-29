# 삭제 운영 목록·복원 경계

`/api/admin/deleted-operations` GET/PUT는 `DeletedOperationRepository`를 사용한다. 기본 PostgreSQL 쿼리는 유지하고, 내부에서 명시한 `deletedOperations` context만 Mongo를 선택한다. 저장소 주입은 관리자 권한을 주지 않으며 `withActivity`의 요청 감사도 같은 명시 경계가 필요하다.

## 보존하는 계약

GET은 삭제된 운영 건의 기존 8필드를 반환한다. 삭제시각 내림차순이며 동률 순서는 보장하지 않는다. 회사·과정·운영 건을 같은 Mongo snapshot으로 읽고 필수 관계 손상은 고정 오류로 실패한다. 삭제자 정보는 권한이 확인된 응답에서 복호화할 수 있지만, 저장 문서·감사·오류에 평문을 남기지 않는다.

PUT은 운영ID를 exact 문자열로 취급한다. UUID변환·trim·대소문자 정규화·빈값 사전거부를 추가하지 않는다. 없는 ID는 예외, 문자열이 아닌 ID와 잘못된 JSON은 기존400, JSON null은 기존 예외 경로다. 이미 활성인 행도 삭제시각·삭제자/HMAC을 null로 정리하고 updatedAt을 다시 갱신한다. 논리차이 없는 재복원은 변경 감사를 추가하지 않는다. 삭제자만 남은 활성 행의 정리도 기존 감사 제외 규칙을 따른다.

## 저장·경합

기존 Company/Course/OperationSession/ActivityChange 모델·codec·validator/index만 사용한다. 명시 setup 외 open은 DDL을 수행하지 않는다. 삭제 필드와 updatedAt만 부분 수정하고 다른 raw 암호문·관계는 보존한다. 복원과 변경감사는 하나의 transaction이며 감사 실패나 시간초과 시 전체 원복한다.

일반 운영 수정·개별삭제·과정 일괄삭제와 겹치는 문서 쓰기는 충돌 후 전체 snapshot을 다시 읽는다. 실제 적용된 직렬 순서가 최종 상태를 결정하며 삭제가 항상 이기는 새 정책은 없다. bulk snapshot에서 제외된 행이나 active 조건을 충족하지 않은 writer의 실패를 복원 실패로 해석하지 않는다. 화면의 선택별 복원 요청을 새 일괄 transaction으로 바꾸지 않는다.

공통 scan은 100행 페이지와 20,000행·32MiB·15초 한도를 유지한다. 목록 일부를 성공으로 반환하지 않고 한도 초과 시 실패한다. 실제 검증 및 transaction/retry 시간 예산의 증거·한계는 `.claude/plans/mongodb-deleted-operations/execution-review.md`에 남긴다. 요청 로그의 후행 실패는 기존처럼 업무 성공을 취소하지 않고 고정 문구로 기록한다.

운영 적용·실제데이터 이전·복구리허설·전체 전환 완료가 아니다. 새schema/의존성/삭제정책/운영설정은 추가하지 않는다. 실OAuth·브라우저·실데이터·운영부하 검증은 별도다.
