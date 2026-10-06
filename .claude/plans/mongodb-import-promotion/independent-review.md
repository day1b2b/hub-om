# 독립 검토

검토자 Volta. 코드·동결 원본·계획·검증 코드·실행 로그를 읽었고 제품/테스트 파일 수정이나 DB/테스트 실행은 하지 않았다. 작성자인 부모·각 테스트 작성자의 자기 검토와 구분한다.

현재: 고아 source의 부모 run 검사 누락(P1)을 보완한 최종 코드·oracle·회귀 증거를 독립 수락했다. 문서·증거 보존·소유 정리까지 최종 독립 수락했다. 원격 통합은 별도다. 아래는 각 시점의 검토 근거이며 마지막 절이 최신 코드 판정이다.

## 수락된 제품/원본 대조

- 기본 PG·명시 scope 누락 차단·기존 반영 분기와 식별자/과정 보존·commit 이후 Calendar 경계를 정적으로 확인했다.
- 정확한 insert 위치와 keyPattern/keyValue에 한정한 자연키 재시도, 최초 포함5회와 공유60초를 확인했다. 감사/불변 unique/commit 불확실성을 이 재시도에 포함하지 않는다.
- PG overlap 일정과 Mongo 실제 경합 네 건의 summary·선행 완료 상태·최종 전체 행·source 참조·감사 전체를 하나의 원본 결과와 대조하는 oracle를 수락했다. pg-race-fixed54/0skip/0fail 로그를 확인했다. 서로 다른 일정의 필드를 섞거나 nullable 감사 항목을 제외하지 않는다.
- 발견한 ordinary writer INSERT 감사 누락 보완이 실제 생성·세 모델로 한정되고 개인정보 가림·기존 제외 필드·UPDATE 정책을 유지함을 확인했다.
- source-digests16개 및 원본 service/route의 동결 hash를 확인했다. 새 확정 P0/P1 제품 결함은 발견하지 않았다.

## 보완 사항

1. 무조건 unique abort는 원본 upsert 성공을 잃을 수 있음: exact 자연키 재시도와 네 가지 실제 경합·허용 원본 일정 전체 대조로 보완.
2. 동일 일정의 PG 두 건/Mongo 재조회 한 건을 문서만으로 수락하지 않음: 실제 PG 겹친 호출의 다른 허용 일정과 전체 tuple을 검증. 전역 직렬화·항상 한 건 보장으로 확대하지 않음.
3. validation 비교 예외의 본문/추가 항목 충돌: 본문에도 시나리오 한정·수락 대기를 명시해 정합 보완.
4. plan의 promotion-only 감사 설명과 ordinary 보완 불일치, manifest 파일/근거 누락: 본문과 변경 목록에 ordinary 신규 세 모델·pg-race-fixed54를 연결했다. 마지막 변경의 최종 문서 확인은 아래 최종 수락 단계에 포함한다.
5. native 네 경합은11000/112를 합산한 실제 insert 충돌 증거다. NaturalKeyRace 네 번 통과라는 주장은 하지 않음. 정확한 분기와 Course 방어적 분류는 주입 검증으로 구분.

## 회귀 집계 조건

첫 전체 로그는49파일/54root/823pass, fail/cancel/skip0 TAP 완결 후 wrapper 오류로 exit1이다. reviewer가 이 구조와49파일 모듈 기록, 영향13파일, source16 digest를 직접 확인했다. 실행 중 driver 변경은 추정 원인이고 Node exit0을 별도 관측했다고 주장하지 않는다.

영향13파일을 최종 불변 소스·완결 TAP·wrapper exit0으로 확인해 이전 파일 결과를 교체하는 방법을 조건부 수락했다. 나머지 파일의 의존 소스 불변과 처음 실패 원본 로그를 보존한다. 전체 단일 불변 SHA 실행 PASS로 표현하지 않는다. 새 근거 없이823개 전체를 반복할 필요는 없다고 판단했다.

최종 actual handler18·일반922/71skip·type/build/lint 및 shadow script7check는 부모 실행 근거가 있으나 최종 로그 재독립 확인, 영향13 완료, 소유 자원 정리, 원격 통합은 현재 별도 대기다. 완료로 미리 표시하지 않는다.

## 추가 P1 — 필수 run 참조

부모가 실제 probe로 재현한 고아 source 승격은 참조 무결성 위반으로 분류했다. getRun(null) 즉시 거부로 원본 빈 결과를 바꾸지 말고, 미연결 source가 있을 때만 같은 transaction에서 부모를 확인하는 최소 보완을 권고했다. 없는 run+source 없음, eligible/blocked 고아 source, run/course/company 누락의 raw rollback과 actual handler 고정 오류·외부 효과0을 요구했다. 코드 변경 후의 최종 로그·소스 확인과 수락은 대기다.

## 최종 코드·실행 수락

Volta가 P1 보완 코드·최초 재현·최종 native60/API22의82 PASS와 wrapper exit0, 보완 후 PG54를 직접 확인해 P1을 CLOSE했다. 최종 소스16개의 전후/현재 digest, impact13 전후 기록과 ordinary writer digest가 일치함을 확인했다. regression-by-file.json을 실제 프로세스별 TAP와 대조해49파일833 PASS를 독립 확인하고 최종 코드·oracle·회귀 증거를 수락했다. 첫 wrapper exit1 한계는 그대로 유지한다. 문서 최종 갱신·정리·원격 통합은 별도 확인 대상이다.

## 최종 문서·증거·정리 수락

Volta가 최종 문서의 수치·제한·잔여 범위, 보존 파일54개의 SHA256 및 임시/캐시 사본 일치, 최종 소스16개 일치, 소유 정리 스크립트와 로그를 직접 확인했다. 소유 PG/Mongo의 빈 저장소 확인·종료·dbpath 제거·포트 닫힘을 수락했다. 코드·검증·문서·증거 보존·정리의 독립 수락을 완료했고 추가 차단사항은 없다. 원격 commit/push·총괄 FF와 최종 SHA 확인은 통합 단계에서 수행한다.
