# 독립 검토

검토자 Volta(`01a0f025-fb83-74d1-971f-ddcf336ec9a6`)는 읽기 전용으로 계획·제품·테스트·실행 로그를 확인했다. 작성자와 분리했고 DB·테스트·파일 변경은 하지 않았다.

## 제품 및 실행 평가

제품 정적 검토에서 P0–P2 반례를 발견하지 않았다. sourceType 선인증/HMAC 원문 확인, transaction과 별도 요청 감사, 기본PG/누락scope/권한, 공개오류 허용목록, 원본 fixture SHA를 확인했다. 이는 실제 실행의 대체 증거가 아니다.

첫 실행 검토는 V2/V4/V6/V7/V8을 수락하고, V1/V3/V5의 검증 공백 두 건을 P2로 남겼다. 정확한 allowlist의 suffix/한국어 오류 부정 사례와 실제 PG 접속 성공 후 환경별 명단/강사 경로 검증이 부족했다. `gap-plan.md`에 따라 보완했다.

보완 후 handler16pass와 PG18pass 로그 및 코드를 확인한 최종 V1~V8 판정은 **수락**, 추가 P0–P2 지적 없음이다. 정확한 allowlist 18사례가 실제POST까지 전달되고, 원본/current×local/notion의 실제PG 명단 양방향 검증과 외부fallback0을 확인했다.

| 기준 | 판정 | 근거 |
| --- | --- | --- |
| V1 | 수락 | 실제JSON/CSV/XLSX, 기본값, 5MiB 경계, exact 오류 허용목록 |
| V2 | 수락 | 원본PG/currentPG/Mongo 전체 논리값·건수·중복·재실행 대조 |
| V3 | 수락 | 저장/감사/응답/console 민감값 비노출·키/HMAC/암호문 손상 차단 |
| V4 | 수락 | DTO·한국어 정렬·199/200/201·동률경계·8/12preview·null/연결 |
| V5 | 수락 | 실제 권한, 누락scope, 요청 격리, 실제PG 환경별 명단·강사 |
| V6 | 수락 | 확정abort 원시값 동일, 두동시순서, retry/unknowncommit/요청감사 실패 |
| V7 | 수락 | 준비거부·자동수리없음·20k/32MiB·기한 |
| V8 | 수락 | 승격PG guard 차단, Calendar0, staging 변경감사 제외 |
| V9 | 실행·정리 수락 | 실패묶음103pass/최종751, 소유정리·로그33개/소스17개해시일치. 제품c11a05c원격통합확인 |

V6/V7은 명시한 장애·시계 주입을 포함한 범위의 수락이다. 실제 네트워크 장애나 standalone 서버 실행으로 확대하지 않는다. 원본PG가 보장하지 않는 startedAt<=finishedAt 가정 제거도 수락했다. 호출 구간·이전 호출 이후 순서·DTO·실제정렬 검증을 유지했음을 확인했다.

## 전체 회귀에서 발견한 검증 환경 문제

기존 coachContent 묶음은 하위41개PASS 뒤 root240초 timeout이며 아직 단독 재검증 전이다. 기존 OM2파일은 과거의 정확한 port/replica 문자열을 요구해 새 합성서버에서 접속 전 실패했다. 이 두 파일에는 현재 소유 endpoint만 명시 허용목록으로 추가하고 actual hello/credential/path/query 차단은 유지했다. 최종 추가검토와 재실행은 후첨한다.

## 최종 실행·정리 수락

Volta는 103pass 재검증, 최초실패를보존한파일별751성공집계, 지속증거33개 SHA/원본사본동일, 소스17개 digest동일, 소유DB0·정상종료·dbpath삭제·포트닫힘을읽기검증해수락했다. 추가제품수정/테스트필요근거없음. 지적된낡은문서상태는현재상태요약과최종인계로갱신했다. 원격통합은별도 integration-review 기준이다.

제품c11a05c의 feature/총괄 원격SHA일치와 FF 통합을 메인이 확인했다. 최종문서상태는갱신완료이며원격증거는integration-review와지속로그를따른다.
