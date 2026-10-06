# 총괄 통합 검토

- 코드: 44307636cb7a627ce6d26f277db3e0f12fd5e7a2, 기준 f8aac3e.
- 총괄 feature에 fast-forward 후 Node24 env-i 전체 회귀 재실행: 895 total / 876 pass / 19 skip / 0 fail. `/tmp/hub-notion-integrated-tests.log`.
- 같은 코드의 Mongo8.0.30 묶음110pass0skip(mock4포함), type/build 성공, lint0error 기존7warning 로그를 대조했다. 일반/native 수치를 합산하지 않는다.
- 독립 총괄 검토에서 추가 확정 P1/P2 없음. 실제 매칭 순서·regular/duplicate 갱신 차이·deleted 표시 보존, catalog→coach 후 재매칭, 인증 후 all 필수 포트 사전확인, 늦은 감사 실패의 행 rollback과 다음행 계속 및 단계별 commit을 코드와 반례 증거로 확인했다.
- 운영 PG 선택·원본 workspace·운영 데이터·키·배포는 변경하지 않았다. 실제 PG/OAuth/UI/실원천/대규모 성능 및 운영 복사·복원·전체 runtime 전환은 미검증이다.
- 다음 구현은 이름이 포함된 sourceEngagementId/sourceEngagementScheduleId의 암호화다. 동일 값의 조회·고유성, 기존 평문/암호화 데이터 변환, PG와 Mongo snapshot/runtime 계약을 함께 검증하며 이 항목을 해결하기 전 전체 암호화 완료를 선언하지 않는다.
