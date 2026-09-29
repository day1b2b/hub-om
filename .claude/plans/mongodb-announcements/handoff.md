# 공지·첨부 인계

기준 5f9d291, 작업 feature/20260929-mongodb-announcements. 격리 clone /Users/ga/workspace/hub-om-mongodb-coach-content. 원본 workspace 미수정. Level3/R1–R6=6, 계획 v2/검증 v2 및 독립 V1–V11 최종 PASS.

구현: announcements repository/context, 기본 PG adapter, 명시 Mongo 저장소, 실제 6handler/3조회page 연결. 최대 5×5MiB 분리 암호화 bytes·BSON-short 조회·부분쓰기·감사 원자성과 기존 수정/삭제·첨부 수 계산 한계를 보존했다. 새 업무 schema/의존성/삭제 정책은 없다.

검증: 일반898pass48skip, 전체 Mongo457pass0skip(mock4포함), 실제PG6/native30/actualhandler-page13. 모두 fail0, exit0. 묶음은 중복 합산하지 않는다. typecheck/build PASS, lint0error/기존7warning. Raw Bytes P2와 초기 fixture 실패는 gap-plan/execution-review에 해결·이력을 기록했다. 미해결 P0–P3 없음.

소유 PG56669/Mongo27769 정상 종료와 합성DB0, 소유dbpath 제거/부재 확인. /private/tmp/hub-om-announcements-20260929에는 로그·스크립트만 남겼다. Node24.19.0/PG17.9/Mongo8.0.30/env-i/합성키·데이터 사용.

현재 구현·검증 완료, 원격 push/총괄 통합 확인은 integration-review를 따른다. 마지막 통합 단계 전에는 다음 작업으로 넘어가지 않는다.

다음 후보: 활동 관리 조회·피드·사용 통계 세 GET. 기존 요청/변경 감사 저장, legacy 코치 콘텐츠, 대상 이름 해석, HMAC 조건·집계·cursor와 권한을 함께 읽고 별도 계획으로 좁힌다. OM접수·배정·가져오기·Calendar 등 전체 잔여와 서비스 이전 조건은 docs/operations/mongodb-cutover-remaining.md 기준.

Do Not: 원본 workspace/운영/Atlas/실원천/실키/env/권한/배포/main/dev/자동화 재개. 생산 기본 PG 유지. 브라우저/OAuth E2E·운영 부하·전수 데이터 암호화·실제 복사/복원/운영 전환은 미완료. dev→main의 전체 완료 조건은 충족하지 않았다.
