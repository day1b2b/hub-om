# MongoDB operation runtime

목표: 승인된 mongodb 7.2.0으로 OperationRepository 생성→조회→수정→동일 요청 재전송을 구현한다. 기준 c257b82281b04d591731842674a583998c77a4b4, 작업 전 clean.

제약: PG factory 유지. 운영 DB/실제 키 접근, push/PR/배포 금지. 합성 데이터 검증만. Next runtime에서 migration codec/schema filesystem 읽기 금지.

성공 기준: DTO/검색/정렬 계약, 암호화/HMAC, projection 누락 거부, 트랜잭션과 audit 원자성, 동일 scope 동시 요청 중복 방지, processSeq 고유성, 실제 indexes/validators 준비 코드, 기존 검증 통과. 실제 Mongo 검증 불가 시 서버 검증 gap을 분리 보고한다.

R1–R6 모두 해당: 다중 파일·트랜잭션/암호화 결합·서버 환경 미정·개인정보 위험·사용자 수직 시나리오·상위 전환 인계. Level 3.

미정: 승인된 shadow DB write 권한. 로컬 Docker 엔진 미실행. 실제 Mongo 실행 증거는 환경 확보 전 미검증이다.
