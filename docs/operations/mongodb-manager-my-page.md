# 담당자 내 페이지 병렬 조회 경계

생산 기본은 PostgreSQL이다. `coachManagerMyPage`를 명시 주입한 context에서만 Mongo를 사용한다. `/coaches/my-page`의 기존 admin guard와 세션 이메일 전달은 유지하며 query parameter로 다른 담당자를 선택하지 않는다. 기존 `coachMyPage.ts` 함수/타입/partition export를 유지해 실제 페이지가 facade를 통해 연결된다.

## 기존 조건

- 활성 예약: `reservedByEmail` 정확일치와 `cancelledAt=null`, 날짜 오름차순. 이메일 공백·대소문자 정규화는 하지 않는다.
- 확정 과정: 이메일 정확일치의 nonnull `confirmedEngagementId`가 있는 예약. 예약 취소 여부와 무관하고 해당 예약의 coach를 사용한다. 동일 engagement는 하나로 합치고 이름경로보다 예약경로를 우선한다.
- 이름 경로: TeamUser 생성일 내림차순 목록에서 trim/lower 이메일이 첫 번째로 일치하는 이름. role 조건은 없다. hiredByText가 원래 이름을 case-sensitive로 포함해야 하고, splitPersonNames 결과의 normalizePersonName도 같아야 한다. 부분 이름·대소문자/공백만 다른 텍스트를 임의 확대 매칭하지 않는다.
- 과정명은 정확 문자열로 그룹화한다. 코치 투입의 시작 최소/종료 최대를 카드 기간으로 쓰고 종료일 내림차순으로 정렬한다. 기존 상태라벨·평가·후기를 유지한다. 슬롯은 취소되지 않은 것만 날짜 오름차순이다.
- soft-deleted 코치도 기존처럼 포함한다. 코치/투입의 새로운 삭제 정책이나 필터는 추가하지 않는다. 오늘 종료 과정은 진행중에 포함하며 진행중은 시작일 오름차순, 지난과정은 기존순서다.

## Mongo 일관성·암호화

각 repository 메서드는 독립 snapshot transaction에서 모든 관계를 읽는다. 확정 과정 조회는 TeamUser도 같은 snapshot에서 읽어 별도 PG/local fallback과 서로 다른 시점의 명단을 섞지 않는다. 페이지의 두 병렬 조회 전체를 하나의 transaction으로 보장하지는 않는다.

예약 이메일은 필드별 HMAC으로 찾고 복호화한 원문이 같은지 검사한다. 이름 substring과 정규화된 명단 이메일은 기존 정책상 bounded 복호화 scan이 필요하다. 필드별 암호화/validator/unique 정책과 공통 행수/byte/시간 한도를 사용하며 한도·키·암호문·관계 오류에서 부분 결과나 평문 fallback을 반환하지 않는다. response는 명시 DTO만 내보내며 보조 HMAC 필드는 제외한다.

null 확정 링크는 제외한다. nonnull ID가 실제 투입을 가리키지 않는 손상은 `MANAGER_MY_PAGE_ENGAGEMENT_NOT_FOUND`로 실패한다. 정상 PG FK상 불가능한 상태이므로 이를 정상 동등성 fixture에 섞지 않는다. 필수 coach 유실도 고정 오류로 실패한다.

## 한계

동명이인 이름 기반 과정 중첩, 같은 시각의 명단 선택, 같은 engagement의 여러 예약 coach 선택 등 기존에 정렬이 명시되지 않은 동률은 새 권한·정렬 정책으로 해결하지 않는다. 로그인 이메일만으로 자유텍스트 이름의 사람 식별을 완전히 보장한다고 표현하지 않는다.

Mongo는 전체 인증 문서를 복호화하므로 PG의 선택 컬럼 scan보다 byte 한도에 먼저 도달할 수 있다. 실패를 명시하며 조용히 잘라내지 않는다. 운영 데이터 규모/부하/모든 collation·동률의 완전 동일성을 검증한 것은 아니다.

schema/migration/의존성/잠금/삭제정책/운영 selector 변경 없음. token backfill과 다른 미전환 기능, 실데이터 복사·복구리허설·운영 전환·브라우저 초안 암호화는 남는다. 실행 근거는 `.claude/plans/mongodb-manager-my-page/execution-review.md`를 따른다.
