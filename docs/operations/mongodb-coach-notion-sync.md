# Notion 코치 동기화 저장 경계

Notion 코치 서비스는 원천 `readPages()`와 저장소를 분리하고 PG/Mongo가 같은 업무 workflow를 사용한다. 기본 운영 backend는 PostgreSQL이다. Mongo는 내부 명시 context에서만 선택하며 Notion/all 실제 handler가 인증 후 필요한 repository/source 및 POST run log를 먼저 확인한다. 불완전한 scope는 외부 읽기·업무·run log 시작 전에 실패한다.

## 매칭과 갱신 정책

기존 코드에서 확인한 정책을 유지한다.

1. notionNo가 있으면 같은 번호의 코치를 먼저 찾는다.
2. 정규화 이름이 같은 코치를 createdAt 오름차순으로 찾는다. 입력 notionNo가 있을 때만 기존 notionNo가 null인 후보로 제한한다. 입력 ID가 없으면 이미 ID가 있는 동명 코치도 매칭한다.
3. 위 매칭이 없으면 같은 정규화 이름 중 전화 **또는** 생일이 같은 가장 오래된 코치를 중복 행으로 본다. 이메일·사번은 식별 기준이 아니다. 전화 문자열을 새로 정규화하지 않는다.
4. 모든 분기는 삭제된 코치를 포함한다. 매칭된 삭제 행의 값을 갱신할 수 있지만 deletedAt/deletedBy를 지우거나 재활성화하지 않는다. 토큰 접근은 계속 거부된다.

원천 순서와 기존 createdAt에 따라 결과가 달라질 수 있다. 같은 createdAt의 새 우선순위를 만들지 않으며, 원본 선별이나 순서 무관성을 보장하지 않는다.

| 항목 | 일반 매칭 | duplicateRow |
|---|---|---|
| name/normalizedName | 기존 값 유지 | 기존 값 유지 |
| 원천 public 값 | 원천에 유효 값이 있으면 갱신 | 기존 null/빈 문자열만 보충, notionNo 유지 |
| phone/email/birthDate/affiliation | 원천 값이 있으면 갱신 | 기존 값이 비었을 때만 보충 |
| private employeeId | 새 프로필 생성 때만 기록, 기존 null도 유지 | 동일 |
| 분야·커리큘럼 | 원천 배열이 비어 있지 않으면 교체 | 기존 해당 관계가 있으면 유지, 없으면 채움 |
| 상태·삭제표시·관리 메모·평가 | 갱신 대상 아님 | 갱신 대상 아님 |

따라서 일반 동기화는 일부 수기 입력을 덮어쓸 수 있다. 중복 행의 빈값 보충과 구분한다.

## 트랜잭션과 경쟁

원천 페이지를 잠금 밖에서 한 번 읽고 각 행마다 catalog→coach 잠금→재매칭·최신 값 조회→쓰기 순서로 처리한다. 기존 시트/관리 writer와 같은 guard를 사용한다. 코치·프로필·마스터 태그·관계·ActivityChange는 한 행의 transaction에서 함께 commit/rollback한다. 실제 Mongo write conflict와 최초/unique 11000은 callback 전체를 다시 실행하며 카운트는 commit 후에만 누적한다.

한 행이 실패하면 고정 오류 코드를 누적하고 다음 행을 계속한다. `/sync/all`은 Notion→계약→일정 시트 순서다. 실패 행이 있는 Notion 결과도 후속 단계로 진행하며, 후속 원천/단계가 throw하면 앞서 commit된 단계는 유지한다. run log는 기존 start→업무→finish의 독립 lifecycle이다. dryRun은 업무·guard·변경감사·run log를 쓰지 않으며 HTTP 요청감사는 별도다.

## 개인정보와 범위 제한

정규화 이름은 기존 HMAC index로 후보를 찾고 복호화 원문이 일치하는지 확인한다. 프로필과 태그는 batch로 읽는다. 생일은 HMAC index가 없으므로 후보 프로필을 복호화한 Date로 비교한다. 개인정보·감사는 기존 codec을 사용하고 외부/driver 오류 원문을 응답·행 errorDetail·run log에 기록하지 않는다.

이 범위는 전체 운영 전환이나 전체 암호화 완료가 아니다. 이름이 포함될 수 있는 sourceEngagementId/sourceEngagementScheduleId 평문은 다음 **필수 암호화 차단 항목**이다. 기존 operational 분류를 사용자 승인된 제외로 해석하지 않는다. snapshot/runtime codec, 검색·고유키·기존 데이터 변환을 함께 보완해야 한다.

실제 Notion/Google 원천, 실제 PG 경합, OAuth/UI, 대규모 성능, 실제 데이터 복사·복원·전체 runtime·배포는 미검증이다. 운영 PostgreSQL과 원본 workspace는 유지했다. 실행 결과는 [검증 기록](../../.claude/plans/mongodb-coach-notion-sync/execution-review.md)을 따른다.
