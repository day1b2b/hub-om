# 다음 실행 계약

- 위치: /tmp/hub-om-coach-schedules-20260922
- 브랜치: feature/20260922-mongodb-coach-schedules, 기준 cc9eeb49.
- 현재 위치: 코치 일정·예약 repository 경계 구현/독립검토/기술검증 완료, feature 보관 단계. 전체 Mongo 이전 initiative는 진행 중.
- 엄격도: Level3. plan/validation/meta/review/manifest/gap/alignment 산출물 완료.
- 검증: 전체837pass16skip, nativeMongo8.0.30 47pass0skip(mock4포함), 새 실제handler14pass, type/build통과, lint기존7warning. 합산 금지. 실행 로그는 manifest.
- 정리: 모든 임의 synthetic DB 삭제 확인. 실제 PG/Atlas 데이터·운영 키·배포 변경 없음.
- 독립리뷰: V1–V7 및 V8기술검증 PASS, 추가 P1/P2 없음. feature commit/push 최종 SHA는 작업 최종보고와 원격 branch ref로 확인.
- 잔여 한계: OAuth/UI/실PG 쿼리·경합 미검증. 범위 밖 확정/동기화/삭제 writer 원자성은 production 전환 gate.
- Alignment: update_next_task.
- Resume: start_next_task.

Do Next: 총괄 branch로 검토·통합한 뒤 engagement 확정/예약 자동취소/관련 동기화를 같은 repository/context/transaction 경계로 구현한다. confirmedEngagementId 이력과 삭제 SetNull/Cascade 정책을 먼저 판독한다.

Do Not: 운영 selector/환경키/DB/배포 조기 변경, 이47개 결과를 앱전체 전환완료로 표현, 실데이터 삭제/시험, 원본 workspace 변경, main/dev 직접 머지.
