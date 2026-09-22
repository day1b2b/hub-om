# 총괄 통합 검토

- 검토 코드: 47b9ba6e6dd99a2e2be7674f093c39ece5af84c9, 기준 f3e80fe.
- 총괄 feature에 fast-forward 후 Node24 env-i 전체 회귀를 재실행했다. 882 total / 864 pass / 18 skip / 0 fail. 로그: `/tmp/hub-sheet-integrated-tests.log`.
- 동일 코드의 담당 실행 기록을 직접 대조했다: Mongo8.0.30 묶음87pass0skip(mock4포함), type/build 성공, lint0error 기존7warning. native와 일반 검사를 합산하지 않는다.
- 독립 통합 검토에서 추가 확정 P1/P2 또는 차단 회귀 없음. catalog→정렬 coach 잠금, 기존 coach-only writer의 역순 잠금 부재, cross-coach confirmed 참조 SetNull, 최신 개인정보 빈값 보충, 감사 rollback, 원천 scope 누락 시 외부호출 차단을 확인했다.
- 실제 PG 경합, OAuth/UI, 실원천, 운영 데이터 복사·복원·배포는 미검증이다. 기본 생산 PG와 원본 workspace를 유지한다.

## 전체 목표의 필수 잔여 항목

1. Notion 코치 동기화는 아직 PG 직접 writer다. 명시 Mongo context에서 외부 조회 전에 차단하며 전체 동기화 완료로 간주하지 않는다. 다음 구현은 해당 저장 경계와 catalog 참여다.
2. `CoachEngagement.sourceEngagementId`, `CoachEngagementSchedule.sourceEngagementScheduleId`는 이름을 포함할 수 있는데 privacy inventory가 operational로 분류하여 평문으로 저장한다. 기존 동작 보존을 이번 전환 회귀 없음의 근거로만 사용하며, 사용자의 전체 개인정보 암호화 목표에서 제외하지 않는다. Notion 전환 직후 암호화 정책·검색/고유키·snapshot/runtime codec·기존 데이터 변환을 함께 보완하는 필수 작업이다. 그 전에는 전체 암호화 완료 및 운영 전환을 선언하지 않는다.
3. catalog 직렬화의 대규모 성능과 기존 날짜 파서 한계는 운영 리허설의 확인 항목이다.

Git 기본 실행기가 Xcode 라이선스 오류를 반환한 후, 이미 설치된 CommandLineTools Git의 정상 실행을 확인하여 사용했다. 시스템 라이선스나 개발자 경로 설정은 변경하지 않았다.
