# Drive history v2 독립 META 최종 검토

## 판정과 검토 범위

**독립 META 판정: ACCEPTED — M1–M6의 계획 반영과 검증 설계 closure를 수락한다.**

이는 Level 3 계획의 수락이다. Drive 제품 구현, 실제 PG/native Mongo/page 검증, 자원 정리 또는 원격 통합의 실행 PASS를 의미하지 않는다. 이 검토자가 수행한 Drive 실행 검증은 **NOT_RUN**이다. 계획 단계의 미해결 META 차단 항목은 없으며, 아래 실행 gate는 후속 수행자가 실제 증거로 닫아야 한다.

검토자는 앞선 외부 `meta-review.md`에서 M1–M6 보완 조건을 제시한 독립 검토자다. v2 계획 작성과 제품 구현을 수행하지 않고, 외부 plan-v2/validation-v2 본문 및 보완 계약을 읽어 조건별 반영을 확인했다. 다른 검토자 전체의 수락, 원본 제품 코드 재검증 또는 실행 검증을 대신 주장하지 않는다.

## 기준과 증거

- 작업 clone: `/Users/ga/workspace/hub-om-mongodb-coach-content`
- 현재 브랜치: `feature/20260930-mongodb-drive-import-history`
- Calendar 최종 baseline: `73a137ac8b8fe16bf6128b81529ab35d6de01031`
- 로컬 HEAD가 위 baseline과 일치함을 직접 확인했다. Calendar 최종 baseline이라는 상태는 사용자 인계에 근거하며, 이 문서 작성에서 원격 통합이나 Calendar 실행 결과를 다시 검증하지 않았다.
- 검토 원본 디렉터리: `/private/tmp/hub-om-calendar-boundary-20260930/next-drive-history-plan/`
- 검토 대상: `plan-v2.md`, `validation-v2.md`; 배경 및 이전 조건: `clarify-result.md`, `plan-v1.md`, `validation-v1.md`, `meta-review.md`.
- 아래 SHA-256은 이 보고서 작성 시 외부 파일에서 직접 읽은 값이다. 이후 문서가 바뀌면 해당 변경 부분은 별도 대조가 필요하다.

| 외부 파일 | SHA-256 |
| --- | --- |
| clarify-result.md | `7afb04a88fe4f7bc2541829476c579714c7021a7d89403b238f5873fbdd8bf5f` |
| plan-v1.md | `b820661fff7431e8057b4c5a6dc2e94f8c55b00b4a481aa2f34b18cb856c77a9` |
| validation-v1.md | `e8dc7fc16fdd3a089316d5dd9b911d8dca839252d5ad5fad0e8dab4bd049b8a7` |
| meta-review.md | `2ecb6aec9a31a1212b672bb86d007ef518be0f76bf6ff5798cb8af565d76beff` |
| plan-v2.md | `1bfe50666dea946bb165f84e2f34ccb0ec5a6948eeb419fb5e979c81cf5e2b37` |
| validation-v2.md | `303840251daf0515bfb792458b5cb0535ed9535a7f9b93bd1589609b5be4f349` |

외부 v1 및 기존 META 보고서는 보존했다. 이 보고서는 외부 초안의 READY/PENDING 표기를 덮어쓰지 않고, 해당 v2에 대한 독립 검토자의 후속 수락을 기록한다. 현재 저장소에 없는 문서를 이미 이관되었다고 가정하지 않는다.

## M1–M6 closure

| 조건 | v2에서 확인한 수용 내용 | 근거 절 | 판정 |
| --- | --- | --- | --- |
| M1 독립 full DTO oracle | 단건/Run/결과 row의 exact own-key·타입·값, 후보의 기존 필터와 중첩 값, 중복 multiplicity를 명시했다. original PG/current PG/native 각각 독립 literal 또는 허용집합에 비교한다. field 추가·삭제, null/빈 문자열, 순서·count·후보 혼합 반례를 요구한다. | Plan M1, C8; Validation V1/V4 보완 | 계획 반영 수락 |
| M2 동률·collation·특수 take | 실제 frozen PG의 take/collation 관찰을 제품 구현 전 gate로 두었다. 우선순위 반례, tagged NaN/Infinity/undefined 전달, 음수 take의 선택·순서·동률 절단, 249+동률3의 정확 길이·포함·중복·전체 DTO를 요구한다. 샘플 일치만으로 임의 Unicode 지원을 주장하지 않는다. | Plan M2, C2, 최종 실행 순서; Validation V2/V3 보완 | 계획 반영 수락 |
| M3 부모·키·namespace | 단건 exact operationId 및 선택 run의 결과 전부를 take 전에 검사한다. nullable/soft-deleted session은 허용하고 session은 동일 namespace/snapshot의 identity projection으로 확인한다. snapshot.operationId와 현재 session.operationId의 일치를 새로 강제하지 않는다. crossnamespace·관계키·keyring·cipher·policy 실패를 구분한다. | Plan M3, C4, Parfit 판정표; Validation V5/V6 보완 | 계획 반영 수락 |
| M4 snapshot·쓰기0 | 정적 fixture는 전체 canonical 문서 digest와 reader의 업무/감사 쓰기0을 확인한다. 경합 fixture는 첫 snapshot 뒤 controller commit이라는 실제 barrier를 두고 이전 DTO/다음 호출의 이후 DTO를 구분한다. controller 쓰기와 reader 쓰기를 분리하여 경합 중 전체 DB 동일성을 요구하지 않는다. | Plan M4; Validation V5/V9 보완 | 계획 반영 수락 |
| M5 실제 페이지 | frozen original PG/current default PG/current explicit native 각각 실제 reader→page 연결을 요구한다. full DTO와 전체 rendered rows/cells/hrefs/query/metrics를 따로 비교한다. 후보7→6/folder5→4/issues4→3 경계, 우선순위, 인증·부분scope 읽기0을 명시한다. 비반환 보호 필드와 legacy candidate 렌더 실패도 별도로 판정한다. | Plan M5, 최종 실행 순서6; Validation V7 보완 | 계획 반영 수락 |
| M6 누적 예산과 비용 | 명시 Mongo reader 호출에만 60초 및 누적20,000행/32MiB를 적용한다. projection/full 재수신·metadata·부모·retry·초과 탐지 문서를 계상하고 exact boundary를 독립 계산한다. 남은시간 전달, 반환 전 검사, 실제 pending read 취소·cursor/session 종료를 요구한다. 공통 store/Calendar framework 확장을 금지한다. | Plan M6, C5; Validation V6 로컬 budget 보완 | 계획 반영 수락 |

M3의 take0/출력 밖/음수 미선택 후보 손상 실패와 M6의 누적 예산은 명시 Mongo의 의도적 차이로 공개되어 있다. 정상 비손상 입력의 full DTO 동등성을 완화하거나 PG도 같은 강화 정책을 적용했다는 주장으로 바꾸지 않는다. take0의 유효성 등 원본 인자 동작은 실제 PG 선행 관찰로 확인한다.

M6은 scan별 제한만 사용하는 대안보다 전체 호출 작업량을 제한하는 이점이 있다. reader-local helper·bounded batch·재사용 경계 fixture·clock 주입과 최소 native 취소 경로로 비용을 제한하는 선택을 수락한다. 공통 quota/lease 시스템 확장, 반복적인 실제60초 대기 또는 근거 없는 무제한 PG 동등성 주장은 수락 범위에 없다. 로컬 취소/유한 cleanup을 증명할 수 없으면 해당 실행 gate는 PENDING으로 남기고 제한된 대안을 재계획한다.

## Level 3 및 R1–R7 추적

Core/Shell/Check 구분, 입력별 출력·허용집합·실패 판정, 독립 oracle, 실행 증거와 인계 단계의 분리는 계획 수준에서 성립한다. 요구사항 및 검증 기준의 고아 항목은 발견하지 않았다.

| 요구사항 | 검증 기준 | 독립 검토 연결 |
| --- | --- | --- |
| R1 기존 API/DTO/PG 의미 | V2,V3,V4 | M1,M2,M5 |
| R2 명시 scope/auth/composition | V2,V7 | M3,M5 및 Calendar 등록 불변식 회귀 |
| R3 선택·정렬·take | V3,V4 | M2 |
| R4 부모·PII·실패 경계 | V5,V6 | M3,M4,M6 |
| R5 실제 사용자 페이지 | V7 | M5 |
| R6 독립 원본·검증 증거 | V1,V6,V8 | M1,M2,M5 |
| R7 쓰기0·제한·정리·인계 | V1,V8,V9 | M4,M6 |

## 실행 상태와 다음 gate

| 항목 | 이 검토의 상태 |
| --- | --- |
| 독립 계획 검토 / M1–M6 closure | ACCEPTED |
| 실제 frozen PG take/collation oracle | NOT_RUN |
| current PG/native full DTO·관계·PII·snapshot·예산 검증 | NOT_RUN |
| 세 실제 page 연결·인증·표시 검증 | NOT_RUN |
| Drive typecheck/lint/build/관련 회귀 | NOT_RUN |
| Drive 실행 환경 준비·정리 증거 | NOT_RUN |
| Drive 제품·원격 통합 수락 | 미수락 — 계획 수락으로 대체 불가 |

후속 순서는 Calendar 원격 통합 확인 → 위 baseline의 frozen closure/manifest 확보 → 실제 PG take/collation 관찰표 확정 → Drive 제품 구현 → v2 필수 검증·정리·독립 실행검토·통합이다. 로컬 HEAD 일치만으로 원격 통합 확인을 대체하지 않는다. Calendar 실행 결과를 Drive의 검증 숫자에 합산하지 않는다.

범위는 두 이력 조회→기존 페이지라는 작은 읽기 흐름으로 유지한다. 제품 writer, 실제 Drive/OAuth/CLI 흐름, schema/registry 변경, 전체 app selector 및 Calendar bundle 확장은 포함하지 않는다. synthetic prepare/seed/정리는 향후 실행자의 명시 소유 환경에서만 제품 read와 분리한다.

사용자의 계속 구현 승인은 유지된다. 이번 검토의 문서 작성 범위를 상위 작업 전체의 plan-only 전환 또는 신규 사용자 승인 대기로 해석하지 않는다. 기술 oracle·취소·정리 증거는 실행자가 닫을 gate다.

## 이번 보고서 작성 행위

직접 수행: 로컬 브랜치/HEAD 확인, 필수 협업·안전 문서 읽기, 외부 검토 문서 읽기와 SHA-256 확인, 이 파일 작성 및 내용 확인.

수행하지 않음: 제품 코드·다른 문서·외부 v1/META 수정, DB·실원천·키환경 접근, 테스트·타입검사·빌드, 네트워크, 커밋·푸시·통합. 본 보고서 한 파일 작성 후 추가 작업 없이 대기한다.
