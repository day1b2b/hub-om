# 강사 Notion 동기화의 Mongo 검증 경계

생산 기본은 PostgreSQL이다. 이 작업은 명시한 `instructorNotionSync`, `instructorNotionSource`, `requestActivity` context에서만 Mongo와 합성 원천을 사용한다. 운영 Notion 연결·운영 데이터 복사·서비스 전환은 수행하지 않는다. 구현/검증 진행 상태와 최종 증거는 `.claude/plans/mongodb-instructor-notion-sync/`를 따른다.

## 저장 계약

실제 `/api/admin/sync-notion-instructors` GET은 미리보기, POST는 반영이다. 기존 Bearer secret 또는 관리자 세션 권한과 응답 형식은 유지한다. Bearer가 일치하지 않아도 관리자 세션이 유효하면 허용하는 기존 정책도 유지한다. 요청 감사는 별도이며 미리보기의 업무 무쓰기와 구분한다.

원천 전체 페이지를 모은 뒤 저장소를 초기화하고 원천 순서로 처리한다. 두 port가 명시 scope에 모두 없으면 원천/PG 접근 전에 차단한다. 원천 실패는 업무 적용 전에 전체 실패한다. 초기화 실패는 빈 원천·전부 skip인 경우에도 전체 실패한다. 매핑 실패는 전체 요청을 실패시키지만 앞 행의 성공을 되돌리지 않으며, 조회/저장 실패는 그 행의 errors를 증가시키고 다음 행으로 계속한다.

NO가 연결 키다. 해당 NO 행이 없을 때만 이름 exact와 notionNo=null인 기존 행을 찾는다. 동명 다른 NO 행은 유지한다. 이름·프로필·동기화 시각을 갱신하고 notionId는 원천 값이 truthy일 때만 바꾼다. recruitAvoid는 동기화 시점의 기존 값과 원천 값의 OR이며, 수동 displayName/notes/partnerId는 보존한다. mapper의 연락처·이메일·생년월일 제거와 지정 텍스트 가림을 유지한다. 모든 자유문자열의 개인정보를 제거한다는 보장은 아니다.

PG17.9/Prisma7.10 원본 실측에서 소수 NO는 0 방향으로 절단되어 정수로 조회·저장된다. Mongo adapter도 절단 후 Int32 범위를 검사한다. 범위 밖과 직접 주입한 NaN/Infinity는 skip이 아닌 행 오류다. 미리보기 문구에는 기존처럼 원래 NO가 표시된다. mapper 자체의 정책을 변경하지 않는다.

## 경합과 감사

Mongo는 기존 강사 위키 저장소의 행 transaction/암호화/감사를 재사용한다. 각 retry에서 대상을 다시 찾고 최신 수동 값·OR·document·감사 차이를 계산한다. 같은 문서의 manual/sync 쓰기는 문서 충돌과 재시도로 처리하고 동일 신규 NO 경쟁은 unique 제약과 유한 재시도로 처리한다. 실패한 행의 업무와 감사는 함께 원복되고 다른 행의 성공은 유지한다.

원본 PG는 분리된 조회/갱신을 유지하므로 Mongo의 동시성 강화와 구분한다. 이름은 고유키가 아니며, 같은 이름을 manual/sync가 동시에 처음 만들면 별도 행이 생길 수 있다. 수동 사용자가 나중에 명시한 false/profile 값은 정상 직렬 결과로 저장될 수 있다. 임의 병합·삭제·새 잠금 스키마를 추가하지 않는다.

기존 transaction은 시도별 30초와 외부 최대 5회 재시도이며 전체 30초 보장이 아니다. 이름 후보 조회는 기존 fullrow scan 20,000행/32MiB/15초 한도를 따른다. 복수 legacy 동명 행의 원본 findFirst에는 순서가 없으므로 backend 간 동일 승자를 보장하지 않는다. 기존 문서 재암호화로 ciphertext는 바뀔 수 있으나 수동 필드의 논리값은 유지한다.

## 오류와 검증

원천/config/fetch/JSON은 INSTRUCTOR_NOTION_SOURCE_FAILED, 초기화는 INSTRUCTOR_NOTION_INITIALIZE_FAILED, 매핑은 INSTRUCTOR_NOTION_MAPPING_FAILED, 행 조회/쓰기/감사는 INSTRUCTOR_NOTION_ROW_FAILED로 정제한다. 오류에는 이름·번호·원천 body·driver message·키를 싣지 않는다. 인가된 미리보기의 이름과 변경 설명은 기존 응답 계약으로 유지한다.

실제 원천/운영 부하/운영 PG18 검증은 이번 합성 PG17.9/Mongo8.0.30 검증으로 대체하지 않는다. 전체 앱 context 구성, 미전환 기능, 실제 복사·복원·최종 전환은 별도다. 최종 검증 수치와 남은 차이는 실행 검토에 기록한다.

HMAC 후보가 없을 때는 같은 snapshot에서 NO가 없는 legacy 전체를 한도 내에서 인증한 뒤 원문 부재를 확인한다. 잘못된 index key나 숨겨진 HMAC 손상을 신규 생성으로 오인하지 않기 위한 추가 검사다. 관련 없는 legacy 손상 또는 scan 한도 초과도 행 실패를 일으킬 수 있다. 후보가 이미 존재할 때 숨겨진 다른 중복 행 탐지, 빈 저장소에서 올바른 키 증명, 동시 최초 이름 생성 직렬화를 보장하지는 않는다.

동기화 감사에는 PG의 nullable INSERT와 프로필 재암호화 표현을 맞추는 별도 처리를 적용한다. 초기 null 필드도 redacted 변경으로 기록하고, HMAC이 없는 notionProfile은 같은 논리 JSON을 다시 저장해도 PG처럼 redacted 변경을 기록한다. 기존 수동 저장 및 공통 감사 helper의 의미는 변경하지 않는다.
