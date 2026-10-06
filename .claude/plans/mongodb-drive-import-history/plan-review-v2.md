# Drive history v2 독립 critic 검토

판정: **ACCEPT — 계획 수락. 추가 계획 차단 조건 없음.**

검토자: 독립 critic Codex(이 대화에서 Parfit으로 식별). 계획 작성자 Volta의 자체검토와 별개로 외부 plan-v2/validation-v2를 읽고 이전 P1/P2의 해소와 범위 유지 여부를 판정했다. 이 보고서는 이미 전달한 최종 수락을 기록하며 제품 구현·실행 수락을 뜻하지 않는다.

## 기준과 검토 대상

- 기록일: 2026-09-30.
- 새 Drive 브랜치: `feature/20260930-mongodb-drive-import-history`.
- 지정 baseline: `73a137ac8b8fe16bf6128b81529ab35d6de01031`. 보고서 작성 시 로컬 HEAD와 일치를 확인했다. 원격 push 상태를 이번 검토에서 독립 확인한 것은 아니다.
- 검토 대상 외부 디렉터리: `/private/tmp/hub-om-calendar-boundary-20260930/next-drive-history-plan/`.
- `plan-v2.md` SHA256: `1bfe50666dea946bb165f84e2f34ccb0ec5a6948eeb419fb5e979c81cf5e2b37`.
- `validation-v2.md` SHA256: `303840251daf0515bfb792458b5cb0535ed9535a7f9b93bd1589609b5be4f349`.
- 선행 검토 근거: 같은 디렉터리의 clarify-result/v1 계획·검증 문서와 실제 Drive reader, 페이지, Prisma schema, privacy 및 repository 경계의 정적 읽기. 외부 v1/v2는 수정하지 않았다.

## 이전 지적의 해소

| 지적 | v2에서 확인한 해소 | 판정 |
| --- | --- | --- |
| P1: take와 손상 검사 순서·고려 후보 범위 | C2/C4 및 최종 실행 순서에서 scope 해석을 우선하고, 원본 거부 인자는 읽기 전 null로 구분했다. 유효 인자는 단건 exact operationId 후보 전부 또는 선택 run의 결과 전부를 take 전에 검사한다. take0·250 밖·음수 미선택 손상 실패를 PG와의 의도적 차이로 명시하고 V5/V6 반례를 고정했다. | 계획상 해소 |
| P2: nullable parent에 없는 관계 규칙 추가 위험 | 같은 namespace/snapshot의 session identity 존재만 확인한다. null·soft-delete·저장 operationId와 parent의 식별자 불일치를 허용하고, 무관한 parent private payload는 조회·복호화하지 않는다. 잘린 projection을 full codec에 넣지 않는 경계도 명시했다. | 계획상 해소 |
| P2: collation·음수 take의 독립 oracle | DB/열 override의 provider·locale·version을 기록하고 baseline 설정을 바꾸지 않는다. 음수의 선택 identity·중복수·순서를 actual frozen PG로 확인한다. 새 comparator를 기대값에 공유하지 않으며 IPC 특수 숫자 보존과 동률 허용집합을 검증한다. | 계획상 해소; 기술 증거 미실행 |
| P2: 누적 예산의 계수 단위 | Run projection/full 재조회, Result, session identity, 호출 중 metadata, retry 재수신까지 실제 raw BSON 수신량으로 계상한다. 같은 문서 두 번 수신도 두 번 센다. 정확 경계 fixture는 전체 합계로 만들고 공통 framework 변경을 금지한다. | 계획상 해소 |
| P2: 보호 필드 반환·비반환 및 기존 페이지 한계 | 반환 보호 필드, 인증하지만 반환하지 않는 summary/notes/folderId, 읽지 않는 session private payload를 분리했다. 저장 error/issues/evidence와 새 runtime 오류를 구별한다. legacy object candidate의 reader 보존과 페이지 렌더 실패를 별도 검사하며 임의 정제 정책을 추가하지 않는다. | 계획상 해소 |

## 범위 판정

저장 이력 reader 두 메서드에서 실제 페이지까지의 수직 단위를 유지한다. 기본 PG의 env 검사와 catch→null, auth 선행, 두 port preflight, 전역 최신 이력과 team query 링크 의미, 기존 Calendar 등록 scope 거부를 보존한다.

새 admin 권한·팀별 이력 접근 정책·문자열 정제·추가 관계 불변식·schema/registry 확대·공통 budget framework를 요구하지 않는다. 명시 Mongo의 더 엄격한 후보 무결성 검사와 reader-local 예산은 기존 PG의 보장이라고 주장하지 않고 의도적 차이로 공개했다. writer·실제 원천·등록 Calendar 전체 조립·전체 PII 전환은 후속 범위로 남는다.

## 남은 실행 gate와 미검증

| 항목 | 상태와 의미 |
| --- | --- |
| 독립 계획 critic 판정 | ACCEPT. 이전 P1/P2의 계획상 해소를 수락한다. |
| Calendar 선행 통합 | Drive 구현은 Calendar commit/push·통합 확인 뒤 진행한다. 지정 baseline의 로컬 HEAD 일치만 이번 기록에서 확인했으며 원격 증거 관리는 부모가 담당한다. |
| actual PG take/collation 기술 oracle | NOT_RUN. frozen PG의 실제 특수 take 반환/catch 결과와 collation 재현 근거를 제품 구현 전에 확보해야 한다. 구현 단계의 첫 기술 증거이며 사용자 재결정·재승인 사항이 아니다. 불일치 시 해당 기술 계약을 증거에 맞춰 재계획한다. |
| Drive 제품 구현 및 PG/native/page 검증 | NOT_RUN. 계획 수락을 실행 PASS로 전환하지 않는다. |
| 타입체크·lint·build·DB·외부 접근 | 이번 critic 작업에서는 실행하지 않았다. |

이 보고서 작성은 지정 문서 한 파일에 한정했다. 제품 코드, DB, 다른 문서, 외부 원본을 변경하지 않았고 커밋하지 않았다. 추가 계획 차단 조건이나 새 사용자 결정은 없다.
