# Plan v1 — Mongo 조회 repository 병렬 구현

기준: 09e3b72, feature/20260922-mongodb-parallel-transition. 현재 checkout에 AGENTS.md 파일은 없으며 총괄 대화에 제공된 AGENTS 지침, working-rules.md, db-write-safety.md, privacy-adapter-contract.md, mongodb-operation-runtime.md, mongodb-shadow-transfer.md와 기존 mongodb-operation-runtime 계획을 확인했다. 오래된 privacy 인계 문서의 브라우저 암호 결정 대기 문장은 이번 서버 조회 범위의 최신 제품 결정으로 사용하지 않는다.

목적: Mongo TeamMemberRepository, CoachRepository, CoachPrivateRepository 조회 구현을 독립 검증한다. 운영 factory는 PostgreSQL 그대로다. 이번 계획 작성은 네트워크·DB 접근·제품 소스 수정 없이 수행한다. 운영 이전이나 전체 35모델 runtime 완료를 선언하지 않는다.

## 핵심 난이도와 대안

1. 기존 Prisma delegate API를 흉내 내어 기존 repository를 그대로 실행: 초기 mapping 재사용에 유리하지만 nested relation/select/orderBy, privacy proxy의 예외, DB별 null/enum 정렬 의미까지 구현 범위가 커진다. 조회 전용 작업에 불필요한 호환 계층이 생긴다.
2. native Mongo 조회 repository와 기존 순수 DTO/bitmap 계산 재사용: 읽기 모델과 DTO 범위가 명확하고 저장 암호화/namespace를 검사하기 쉽다. 대신 관계 조회와 정렬·archive fallback 의미를 직접 검증해야 한다. **2번 선택**. 공통 함수를 추출한다면 기존 PG 동작과 호출부는 바꾸지 않는다.

## 실행

1. [Core] 담당자별 인터페이스/Prisma 동작 표 작성. Team은 Member active+role null 조회, team 미정 처리, TeamUser 역할 목록, 빈 목록/OM 부재 기본 명단을 구분한다. Coach는 list/get의 서로 다른 삭제 필터, 평가 평균/고유 근무일, 일정/engagement 기간·취소 정책, 월별 대시보드의 시간 bitmap/예약 중첩, archive public detail fallback을 포함한다. Private는 profile 날짜/null과 feedback 순서를 포함한다. 기존 feedback 공개 DTO와 coachInputUrl은 인터페이스상 허용 여부를 근거로 판단하며 임의 권한 정책 변경을 섞지 않는다. 수락 V1–V5.
2. [Core] 공통 MongoOperationStore 모델 allowlist/setup 확장은 총괄만 수정한다. Team/Coach 담당은 필요한 전체 모델 목록과 인덱스·validator를 총괄에게 전달한다. 명시적 승인 shadow DB/namespace/client만 사용하고 PG fallback·기본 URI DB 선택·생산 factory 변경을 금지한다. 조회 호출은 DDL/setup/수정/감사 쓰기를 실행하지 않는다. 별도 setup을 완료하지 않은 namespace는 명시적 실패. 수락 V6/V9/V15.
3. [Core] 기존 runtime codec/AAD/HMAC/날짜/Decimal 계약으로 인증 복호화한 뒤 DTO를 조립한다. 전체 복호화 후 데이터 유실을 숨기는 catch→빈 배열/기본 명단 처리를 금지한다. Member/TeamUser, Coach/PrivateProfile, Field/Curriculum 관계, Schedule/DayReservation/Engagement/EngagementSchedule, ArchiveSnapshot/ArchiveRow 등 실제 사용 모델을 빠짐없이 준비한다. 조회 간 동시 변경 일관성 필요 여부를 명시하고 무제한 전체 collection 스캔이나 행 제한 후 조용한 잘라내기를 금지한다. 수락 V6–V10.
4. [Check] 합성 fixtures를 PG reference와 Mongo 두 구현에 동일하게 적용해 DTO/필터/순서를 대조한다. 우선 mocked 단위 검증 후 승인된 synthetic replica-set namespace에서 실제 암호문과 관계·인덱스 기반 조회를 확인한다. production export/실제 자료 복사는 총괄의 독립 job이며 이 테스트 fixture와 섞지 않는다. 수락 V11–V15.
5. [Check] 독립 리뷰→지적 수정→관련 검증 및 전체 test/lint/typecheck/build. 실행한 명령·합성 검증 대상·skip/실행 불가 조건을 구분하고, 운영 factory unchanged와 원본 PG 무수정을 diff로 확인한다. 결과 문서/최종 로컬 커밋은 총괄 조정에 따른다. 작성자는 자신의 완료 선언을 독립 리뷰로 대체하지 않는다.

## 주요 실패 조건

- Mongo 문자열 정렬과 PG enum/null/한국어 정렬이 다르면 default 명단 또는 코치 목록 순서가 바뀐다. reference 비교로 명시 판정하고 임의 재정렬하지 않는다.
- Coach detail은 archive fallback 및 여러 관계가 있어 1개 모델 read 성공만으로 완료할 수 없다. 관계 누락·손상은 정상 빈 관계와 구별한다.
- public DTO라는 주석만 믿고 sourceCoachId/accessToken/private field를 통째로 반환하지 않는다. 실제 인터페이스 허용 필드만 반환한다.
- read repository를 생산 factory에 연결하면 PG/Mongo 시점 불일치가 즉시 서비스에 노출된다. 연결은 이번 범위 밖이다.
- 부분 조회/정렬 상한 초과, key/AAD 변조, validator/index 부재는 결과를 잘라 성공시키지 않고 실패한다. synthetic 테스트 통과가 운영 권한·전체 데이터 성능·cutover 검증을 대신하지 않는다.
