# MongoDB 병렬 이전 상위 계획

목표: 기존 PostgreSQL 운영을 유지하며 개인정보를 암호화한 별도 MongoDB를 검증한 뒤 안전하게 전환한다.

1. 복사 기반: 35모델 read-only export, 암호화 spool, insert-only import와 참조/고유키 검증. 코드와 합성 검증 완료, 실제 복사 미실행.
2. 런타임 전환: Operation 작성/조회 구현 후 도메인별 repository와 API·배치·권한·감사를 순차 전환. 이번 범위는 Team/Coach 조회 10개. 종료 기준은 모든 사용 경로와 회귀·권한/암호화 검증 완료이며 아직 진행 중이다.
3. 운영 리허설: 실제 source mode 확인, 승인된 shadow 복사, 데이터/화면/성능 동등성, 백업 복원·역동기화/전진 복구. 미실행.
4. 전환: 원본 쓰기 동결, 최종 snapshot/sequence 상한, 데이터 대조, 검토 후 factory·배포 연결. 운영 신규 쓰기 이후 단순 PG 주소 복귀 금지. 미실행.

운영 PG backfill, 전체 환경 복제, 키 변경, 기존 미커밋 파일 변경을 이 조회 작업에 섞지 않는다.
