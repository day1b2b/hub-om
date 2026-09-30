# Health 계획 v2

대안 A: route에서 MONGODB_URI를 보고 분기한다. 적은 파일이지만 생산 선택을 암묵 변경하고 scope 누락 fallback 위험이 있어 거절한다. 대안 B: 기존 DataRepositories에 databaseHealth port를 추가하고 기본 PG/명시 Mongo repository를 선택한다. B를 선택한다. namespace/schema 검사를 health에 추가하는 대안은 기존 SELECT 1보다 의미를 확대하므로 별도 전체 앱 readiness로 남긴다.

## S1 [Shell] 원본·계약 고정

현재 health 원본 route와 기본 PG getter 의존성을 기준 SHA에 고정하고, 인증/proxy/활동 제외·배포 설정의 실제 호출 관계를 확인한다. 원본과 새 route를 동일 합성 성공/실패 및 실제 PG에 연결해 production 응답 동등성을 확인한다. 새로운 nonproduction 고정 오류는 의도적 차이로 명시한다. 원본 getter를 우회한 검증은 실제 privacy/PG 연결 증거로 주장하지 않는다.

## S2 [Core] 저장소와 API

DatabaseHealthRepository.check():Promise<void>, getDatabaseHealthRepository 기본 Prisma와 명시 databaseHealth 선택. PG는 기존 앱 getter와 SELECT 1, native는 explicit borrowed client+shadow database의 ping1만 호출하며 5초 CSOT, 키 형식 검증을 적용한다. native는 env URI fallback·client close·DDL/업무 조회·준비/수정이 없다. shadowDatabaseName에 명시 객체를 전달해 운영 DB 이름을 거부한다.

GET은 포트를 호출하고 기존 production 응답/상태와 dynamic을 유지한다. 모든 공개 실패는 고정 Health check failed로 제한해 URI/키/원문 오류를 노출하지 않는다. scope 누락은 PG로 넘어가지 않는다. 키가 맞는지 업무 암호문을 읽어 검증하거나 replica 쓰기 가능성·schema 준비를 판정하는 endpoint가 아니다. 기존 공개·감사 제외 정책을 보존한다.

## S3 [Check] 실제 검증

성공200/실패503/응답 shape/content-type·dynamic, PGdefault/Mongo명시/누락scope·중첩/동시A/B, raw Error/nonError/URI/cause 비노출, 호출0 import, 변동 없는 proxy/감사 제외를 검증한다. 실제 새 로컬 PG+Mongo replica set에서 check와 실제 GET을 연결하고 쓰기0·비즈니스 조회0·부재/연결 실패를 관찰한다. 잘못된 키 형식과 운영 이름은 I/O 전 거부, borrowed client는 살아 있어야 한다. driver 오류는 실제 위임 후 관찰과 명시 합성 장애를 구분한다. timeout은 실제 지연 또는 측정 가능한 제한 검증을 사용하고 Promise.race만으로 socket 취소를 주장하지 않는다.

일반 test/typecheck/lint/build 및 독립 code/evidence review, 이전 검증 재사용 hash를 기록한다. 검사 실패를 숨기거나 실제 운영 환경/백업 증거로 확대하지 않는다.

## S4 [Check] 정리·통합

소유 DB 행·client·operation0 확인 후 서버/포트/dbpath 정리. 실행·정합·인계/coverage/macro를 갱신하고 기능→총괄 FF/atomic push/원격 SHA 확인. main/dev·운영·자동화는 변경하지 않는다. 다음 범위는 관리자 backup 또는 활성 CLI 조사 중 실제 코드 근거로 선택한다.


## 검토 반영
validation-v2의 V1–V5를 수락 기준으로 확정한다. Mongo 미생성 DB ping 성공은 정상이며 생성/스키마 검증을 요구하지 않는다. 5초 제한은 Mongo만 적용한다. 유효 형식의 다른 키도 연결 확인을 통과할 수 있다. 원본9개 런타임 의존성은 기준 Git blob으로 고정하고 서로 다른 프로세스로 실행한다. 메타 검토 차단 없음.
