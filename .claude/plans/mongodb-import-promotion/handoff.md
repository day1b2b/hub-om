# 재개·인계 계약

- 작업 clone: `/Users/ga/workspace/hub-om-mongodb-coach-content`.
- 작업 branch: `feature/20260930-mongodb-import-promotion`, 기준 `75125c9644d6c8265fbdae59e5c9d450247170ef`.
- 제품 구현·검증·독립 코드/회귀 수락·소유 합성 정리 완료. 최종 문서·증거 보존·소유 정리도 독립 수락했고 commit/push·총괄 통합만 대기다. 실제 SHA는 integration-review를 따른다.
- 일반922pass/71skip, 실제PG54pass/0skip, Mongo49파일의 최종 중복 제거833pass. 개별 저장60/API22는833에 포함하며 합산하지 않는다. typecheck/build 통과, lint0error/기존7warning.

원본 PG의 분기·권한·source 연결·차단행·재실행과 삭제 표시 복원을 유지한다. commit 이후 Calendar와 페이지 갱신 실패를 업무 rollback으로 오해하지 않는다. 실제 네 가지 Mongo insert 경합을 원본 PG의 허용 동시 일정 전체 tuple과 대조했다. 생성 감사의 nullable 누락과 필수 부모 run 없는 source 승격(P1)을 발견·보완하고 독립 코드/로그 근거로 닫았다.

첫 전체 TAP는823pass였지만 이후 wrapper 오류로 shell exit1이다. 실행 중 driver 수정이 추정 원인이며 Node exit0은 별도 관측하지 않았다. 최초 결과에서 영향13파일367개를 최종369개로, 이후 promotion 두 파일74개를 최종82개로 교체해833을 계산했다. 전체 단일 불변 소스 명령 PASS라고 보고하지 않는다. 원본 실패와 각 단계 소스·실행 결과는 보존했다.

증거: `/Users/ga/.cache/hub-om-verification/20260930-import-promotion`의54개 파일/SHA256, 이 폴더의 source-digests16개와 regression-by-file.json. 소유 PG56739/Mongo27839의 빈 저장소를 확인한 뒤 종료·dbpath 제거·포트 닫힘을 확인했다. 이미 정리한 환경을 재사용하지 않는다. 추가 검증이 필요하면 새 소유 환경을 만든다.

Do Next: commit/push·총괄 FF 및 원격 SHA 확인 → 별도 Calendar Task의 계획 보완/수락과 새 branch 착수. Calendar draft는 `/private/tmp/hub-om-import-promotion-20260930/calendar-plan`에 있고 critic/meta 보완사항을 먼저 반영한다. 선행 통합 SHA 확정 전 제품 작업을 섞지 않는다.

Do Not: 원본 workspace, 운영 DB/Atlas/실원천/실Google, 운영 키/env·배포·main/dev·자동화 변경 금지. 새 의존성·업무 필드·삭제 정책 임의 추가 금지. 완료된 staging/기존 기능을 반복 구현하지 않는다. 기능 단위마다 재승인을 요청하지 않는다. Resume action: continue_current_task.

생산 기본은 PG다. 전체 앱 구성, 실원천·Drive·활동 쓰기/보존·backup/health·CLI, 실제 독립 A/B 백업·복원·최종 복사·무손실 복귀·전환은 별도 미완료다. 실백업 증거0, dev→main 완료조건 미충족. 브라우저 임시 초안 암호화는 별도 후속이다.
