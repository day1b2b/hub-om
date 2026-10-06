# Rigor Sizing: mongodb-coach-public-pages

## Context

- Macro plan: `.claude/plans/mongodb-read-repositories/macro-plan.md`
- Current task: 공개 코치 조회 factory/context 및 실제 페이지 조립
- Execution unit: Task

## R1-R6 Checklist

| Axis | Checked | Reason |
| --- | --- | --- |
| R1 Effort / Size | yes | factory·context·페이지 통합 테스트·문서가 함께 바뀐다. |
| R2 Complexity | yes | 기존 repository contract와 여러 페이지를 조립한다. |
| R3 Uncertainty | no | 기존 scope/factory와 Mongo 구현 패턴이 확립돼 있다. |
| R4 Risk / Blast Radius | yes | 코치·강사 위키·운영 상세의 기존 조회 동작에 영향을 줄 수 있다. |
| R5 Validation Need | yes | 페이지가 오류를 숨일 수 있어 금지 PG 호출과 실제 사용자 의미를 함께 관찰해야 한다. |
| R6 Handoff Need | yes | 전체 앱 조립의 다음 진입 기준과 운영 백업 gate에 영향을 준다. |

Measured score: 5/6

## Forced Upgrade Check

- Contract composition change: yes
- Macro plan change: yes
- User-facing behavior change: intended no, regression risk yes
- Whole Wave execution: no
- Complex/Cynefin character: no
- Failure may change upper plan: no

## Selected Harness

- Selected level: Level 3 validated-plan Harness
- Reason: score 5이며 R4/R5와 공통 repository 조립 변경이 있다.
- Evidence required: validated plan set, actual factory/page/native checks, execution manifest/review, alignment review, full handoff.
