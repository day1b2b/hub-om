# 활동 기록 정리 전환 실행 기록

기준 통합 커밋은 `b333931a2e7d281b697baf20a75bdf13b8e2b094`이며 작업 브랜치는 `feature/20260930-mongodb-activity-prune`이다. 원본 workspace, main/dev, 운영 DB와 원천에는 접근하거나 변경하지 않았다.

## 구현

기존 CLI를 명시적 repository 경계로 분리했다. 기본 PostgreSQL은 원래 SQL과 10초 트랜잭션을 유지한다. Mongo는 명시적으로 주입한 shadow context에서만 사용한다. 명시 context의 서비스 누락은 환경 로드와 기본 DB 접근 전에 실패한다.

Mongo 배치는 서버 시각을 한 번 읽어 요청 기록 30일, 변경 기록 365일의 기준을 공유한다. 모델별 오래된 순서로 최대 1000개를 같은 트랜잭션에서 삭제한다. 기존 API 자동 정리도 같은 helper를 사용하되 전체 4초, 개별 작업 1500ms 예산과 한 시간 간격·best-effort 동작을 유지한다. CLI는 전체 배치 10초이며 성공한 배치를 반복한다.

원본과 같이 삭제 합계를 먼저 출력하고 연결을 닫는다. 연결 종료 실패 시 이미 출력한 합계는 남지만 고정 오류와 실패 종료 코드를 반환한다. dotenv 자체 안내 출력은 기존에도 있으므로 전체 표준 출력이 JSON 한 줄이라고 보장하지 않는다. Mongo client는 호출자 소유이며 repository close가 닫지 않는다.

## 현재 확인 결과

- 실제 Mongo 8.0.30 snapshot 트랜잭션에서 collectionless `$documents → $$NOW` 조회가 동작한다. session 종료와 probe DB 미생성을 확인했고 독립 검토가 수락했다.
- 기존 API/context 및 관리자 DB handler의 실제 Mongo 회귀: 12 PASS, 0 skip, 0 fail. 기존 인증·감사 경로가 유지된다.
- 일반 1082 PASS / 99 opt-in skip / 0 FAIL. command 21 PASS는 일반 검사의 부분집합이다.
- 실제 Mongo 최종 12 PASS / 0 skip / 0 FAIL. 변경 후 기존 API/context·관리자 handler도 별도 12 PASS. 전체 역사 Mongo 묶음의 재실행은 아니다.
- 실제 frozen original/current PG 비교 root 1 PASS / 0 skip / 0 FAIL, 36개 worker 관찰. UTC 기본 사례·Asia/Seoul 추가 사례, 실제 CLI·rollback·부분 commit·재실행·동률·microsecond 경계를 검증했다. PG 정확 동률 관찰은 양쪽 false이며 PASS로 확대하지 않는다.
- typecheck-pg-final, build, lint-pg-final 통과. lint 오류 0·기존 경고 7. 일반 검사 이후 PG opt-in 출력 parser·음성대조·digest만 보완했고 실제 PG·최종 타입·린트로 재검증했다. 제품 8개 파일 hash는 동결본과 동일하다.
- 독립 제품 리뷰의 getMore P1은 singleBatch/1000개 projection으로 해소했다. 실제 101/999/1000/1001의 수·잔존 전체 행·getMore 0을 검증했다. 독립 실행 증거 검토도 수락했다.

## 실패와 보완

- CLI 출력 P2: tip 허용 범위를 정확한 8개 문구·줄 수·순서·음성대조로 보완했다. Node assertion의 숫자 diff 때문에 음성대조가 한 번 실패했으며 고정 진단 helper로 수정 후 21 PASS.
- native 첫 실행은 10 PASS / 2 FAIL(root 포함). currentOp에서 연결 유지 hello까지 대기한 것이 원인이었다. 소유 DB 정리 명령·해당 session의 commit/abort를 관찰하도록 수정했고, 재실행에서 hello 1·정리 명령 0 확인 후 12 PASS. 개별 취소 약 1501ms, 재시도 전체 약 4001ms. 클라이언트 취소가 서버 작업을 즉시 종료한다고 주장하지 않는다.
- 타입 검사: 테스트 변수 2개 추론 오류를 number 표기로 보완 후 통과.
- PG 첫 실행: subprocess 정상 종료 후 검증기가 dotenv 접두사를 잘못 예상해 실패. 설치된 `◇ injected env`와 사례별 주입 수·순서·빈 줄·추가 출력 음성대조를 반영 후 최종 통과.

## 증거와 자원 정리

영속 근거는 `/Users/ga/.cache/hub-om-verification/20260930-activity-prune`이다. source-final.json 1049개 파일, sha256.json 29개 증거, 제품 8개 hash 일치. 실패 로그도 보존했다. 원본 SQL·정책·codec·schema·의존성 등 11개 기준 파일은 불변이다.

PG 35개 테이블 0행·다른 연결 0, Mongo 시스템 DB만 잔존·failpoint off 확인. 정확한 PID/명령 대조 후 서버 종료, 56758/27858 포트 닫힘·두 dbpath 삭제를 확인했다. 빌린 Mongo 실행 파일은 보존했다.

## 검증 한계

Mongo exact cutoff·transient·commit ACK는 명시 주입이며 자연 발생 운영 장애의 재현이 아니다. 실제 서버 장애의 롤백·지연 검증과 구분한다. CLI 10초 설정은 확인했으나 실제 10초 지연 자체는 별도 실행하지 않았고 공유 helper의 API 4초/1500ms를 검증했다. PG microsecond와 Mongo millisecond의 물리적 시각 일치를 주장하지 않는다. 운영·실원천·예약 설치·전체 앱·브라우저·복사·복원·운영 전환은 미실행이다.

## 검증 환경

Node 24.19.0, 격리 PostgreSQL 17.9 및 MongoDB 8.0.30 replica set. 새 loopback 포트·dbpath와 합성 데이터·임시 키만 사용한다. 실제 운영 스케줄러 설치, 전체 앱 구성, 실데이터 이전·복원·운영 전환은 이번 검증에 포함되지 않는다.
