Plan-v1-review — Step5

최종 판정: **조건부 수락, plan-v2 보완 필요.** 현재 plan-v1 자체의 최종 수락이나 구현 PASS는 아닙니다.

Phase A — 구조
Core 2개로 PASS. Shell과 Check가 분리되어 있습니다.

Phase B — Core 품질

- 결정성 PASS: NO=10 행과 동명 null-NO 행이 함께 있으면 NO=10 행 갱신으로 결정됩니다.
- 변별성 PASS: 같은 신규 NO 두 건은 dry-run에서 create/create, apply에서 create/update로 구분됩니다.
- 추적성 PASS: 대상 선택은 Core1, retry 재매칭·수동값 보존은 Core2, port/원천 경계는 Shell에 연결됩니다.

Phase C — 기준 대조

- V1: 기본 계약은 적합. numeric 판정표 실측과 oracle의 stripPii 동결·정규화 제한을 명시해야 합니다.
- V2: 기존 class 재사용 방향은 적합. 실제 manual 양방향 경합과 callback 내부 재계산, 허용되는 동명 신규 생성·후행 명시 쓰기 한계를 명문화해야 합니다.
- V3: 수정된 initialize 인터페이스는 적합. 호출 위치·횟수·실패 행렬과 initialize/mapper 고정 오류 코드가 계획에 추가되어야 합니다.

plan-v2 필수 수정 목록

1. “NO 없음”을 “해당 NO의 저장 행 없음”으로 정정하고, numeric 실PG 판정표 확정 전 PASS 금지를 명시합니다. 새 skip 정책은 금지합니다.
2. 원본 mapper/stripPii까지 oracle을 보호하고, 정규화 가능한 UUID·시각 위치를 제한합니다.
3. 실제 manual 두 메서드의 양방향 barrier, 전체 재매칭·OR·document·감사 diff의 retry 내부 재생성을 명시합니다.
4. 같은 이름 최초 생성의 중복 가능성과 후행 manual false/profile 쓰기를 허용 한계로 기록합니다. 전체 30초·ciphertext 동일성을 요구하지 않습니다.
5. initialize 순서·1회·행 catch 밖·PG 동기 구성 확인/Mongo no-op 및 빈/skip/정상 입력 실패 사례를 반영합니다.
6. source/initialize/mapper/행/요청감사의 오류 경계를 분리하고 미정인 고정 코드를 확정합니다. 공통 syncJsonResponse로 다른 sync 계약을 변경하지 않습니다.
7. 동일 profile·nullable 감사 parity의 실PG 증거를 요구하고, 업무 dry-run 무쓰기와 요청감사를 구분합니다.

추가 제품 결정은 없습니다. 남은 것은 계약 명문화와 numeric·감사 실측 증거이며, 미확정 항목을 성공으로 간주하지 않는 조건으로 후속 계획을 작성할 수 있습니다.

## Plan v2 최종 독립 수락 — Anscombe
plan-v2 수락. Core2/S1–S3유지, initialize/오류경계/oracle/실경합보완반영. 실PG의절단후Int32검사·preview원래NO보존·errors대skip분류적합. 구현차단점없음. profile/nullable감사parity는실행필수검증으로남음. 계획수락이며실행PASS아님.
