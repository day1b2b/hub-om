# 인계

- Initiative: PostgreSQL 운영 유지 → 별도 Mongo 암호화 검증 → 전체 런타임/데이터 전환. 진행 중.
- 현재 Task: API repository 경계, 실제 handler 인증/감사/격리 검증. plan-v2 기준 구현 완료, 독립 최종 검토 기록 참조.
- 위치: /tmp/hub-om-mongodb-20260922, feature/20260922-mongodb-parallel-transition. 원본 workspace dirty 파일 보존.
- 읽기 순서: 상위 mongodb-read-repositories/macro-plan.md → plan-v2 → execution-review → execution-manifest → gap-plan → docs/operations/mongodb-runtime-coverage.md.
- 검증: 전체 814 pass / 12 skip; Mongo8.0.30 묶음 30 pass / 0 skip(mock4 포함); type/build pass; lint 기존7warning/0error.
- 운영 미반영: production factory 기본 PG, 실제 복사/복원/배포 미실행. 새 env selector 없음.
- 다음: 코치 토큰 인증/본인 조회/개인정보 export 경계부터 구현. Team 삭제·scan 한도·전체 writer guard는 gap-plan.
- 금지: 부분 runtime 준비만으로 생산 Mongo 선택, 기존 미커밋 파일 수정, 운영키/DB 임의변경, 합성 검증을 실제 데이터/화면 검증으로 보고.
- Resume: start_next_task. 추가 사용자 설정은 현재 불필요하며 운영 권한/중단 확인이 필요해지는 시점에 구체 안내.
