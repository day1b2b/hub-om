# 코치 콘텐츠 병렬 저장 경계

생산 기본은 PostgreSQL이다. `coachContent`를 명시 주입한 검증 context에서만 Mongo를 사용한다. 메모 목록/생성/수정/소프트삭제/경고, 콘텐츠 피드, 월별 등록 현황 및 status API가 대상이다. 관리자 페이지 삭제 코치 수는 `coachAdmin.countDeletedCoaches`를 사용한다.

## 보존하는 계약

- API는 workspace 권한, 관리 페이지는 admin 권한이다. `admin/content-entries` 이름을 이유로 관리자 전용으로 바꾸지 않는다. 요청 감사도 같은 context에 반드시 주입한다.
- 메모 mutation과 EDIT_HISTORY, 변경 감사는 하나의 transaction이다. 작성자는 최초 작성자를 보존하고 편집자 정보는 이력에 기록한다. 경고 토글이 본문 수정보다 우선한다.
- 기존 `id + coachId` 조건을 유지한다. 삭제 코치/삭제 메모/EDIT_HISTORY를 새로 금지하지 않는다. 일반 메모 삭제는 soft delete이며 관리자 코치 영구삭제의 기존 승인 범위를 확대하지 않는다.
- 피드는 미삭제 NOTE 최대 300개와 rating 또는 feedback이 null이 아닌 투입 최대 300개를 합친다. 삭제 코치도 포함한다. feedback 빈 문자열과 rating 0은 null과 다르다.
- 월별 상태는 ACTIVE/미삭제 코치와 해당 월 접근 로그로 판단한다. `isActive`나 실제 일정 건수로 대체하지 않는다. 기존 정규식상 `0000-01`도 허용한다. status 응답에는 토큰/입력 URL을 추가하지 않는다.
- `logProfileEdit`/`logReviewEdit`의 기존 PG helper는 별도다. 명시 context에서는 PG 접근 guard가 차단하며 Mongo writer의 자체 이력을 중복 생성하지 않는다.

## 원자성·암호화

Mongo 메모 writer는 scheduling guard 후 코치 존재와 대상 메모를 읽는다. purge의 catalog→scheduling 순서와 충돌하며 역순 catalog 획득은 하지 않는다. 메모/이력/감사 오류는 전체 rollback, 요청 감사 기록 오류는 기존처럼 업무 성공을 유지한다. 모든 오류는 고정 코드로 처리한다.

기존 privacy codec과 validator/HMAC 정책을 그대로 사용한다. 저장소는 전체 문서를 인증·복호화하고 응답에는 명시한 논리 필드만 내보낸다. 승인된 사용자 응답의 복호화 값은 저장 평문과 구분한다. 변경 이력 대상 자체의 중복 ActivityChange는 만들지 않는다.

## 다중 묶음 조회

설치된 Mongo driver 7.2에서 transaction CSOT와 일반 cursor getMore 조합은 잘못된 maxTimeMS를 보내고, cursor timeoutMS override도 거부한다. 임의 배치 크기 증가나 드라이버 내부 수정 대신 공개 singleBatch 옵션과 다음 기본키/정렬키 조건으로 이어 읽는다. BSON 크기로 짧은 묶음이 반환되어도 빈 묶음을 확인할 때까지 읽는다. 20,000행·32MiB 제한을 유지하고 각 페이지 시작·완료 시 15초 기한을 검사해 초과한 결과는 성공으로 반환하지 않는다. 진행 중인 네트워크 요청의 중단 시간은 transaction CSOT가 결정하므로 정확히 15초에 응답한다는 보장은 아니다. 콘텐츠 피드는 source별 누적 300개에서 중단한다.

## 한계·배포

- 정렬값이 같은 행의 PG 기존 순서는 정의되지 않았다. Mongo는 `_id`로 동률을 정리하므로 300번째 동률 선택 집합까지 같다고 보장하지 않는다.
- 한국어 locale 정렬과 PG collation의 모든 문자열 순서가 같다고 보장하지 않는다. 고정 합성 fixture의 동등성과 운영 collation/부하 검증을 구분한다.
- Mongo 동시 토글 정합성은 신규 구현으로 검증하며 기존 PG의 동시성 한계를 수정하는 별도 정책 변경은 포함하지 않는다.
- schema/migration/의존성/생산 selector/배포 설정 변경 없음. 실제 데이터 복사·복구 리허설·키 보존·최종 전환은 별도다.
- 적용은 기능 브랜치 검증→총괄 통합 회귀 순서다. 운영 기본이 PG이므로 이 변경만으로 운영 DB를 전환하지 않는다. 실제 전환 전에는 coverage의 남은 경로와 기존 shadow 정책/복원 계획을 검토한다.

실행 근거: [실행 검토](../../.claude/plans/mongodb-coach-content/execution-review.md). 이번 경계 완료가 전체 앱·브라우저 초안·운영 데이터 암호화 완료를 뜻하지 않는다.
