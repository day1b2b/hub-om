# 상위 계획 정합 검토

목표는 기존 기능·권한·개인정보 보호를 유지한 Mongo 이전이며, 이번 단위는 가져오기 자료를 운영에 반영하는 수직 경계다. 새 업무 모델·unique·삭제 정책·외부 SDK를 추가하지 않았다. 원본 PG를 기본으로 유지하고 명시 Mongo context에서만 새 구현을 사용한다.

공유 core의 정상 알고리즘을 원본 그대로 유지했으며, source 연결/복원/재실행과 commit 후 Calendar의 의미를 실제 PG·Mongo·actual POST로 대조했다. 저장소 구현만으로 성공을 선언하지 않고 전후 원시 저장 상태, 감사 필드, source 참조, HTTP와 외부 효과 횟수를 별도로 확인했다. source fixture/route와 실행 소스 hash를 보존했다.

구현·검증 중 실제 근거로 세 가지를 보완했다. 자연키 insert 경합의 제한 재시도와 원본 허용 일정 대조, 일반 Mongo 신규 생성 감사의 nullable 필드 누락, 필수 run 부모가 없는 source의 잘못된 승격이다. 감사와 필수 참조 보완은 기존 PG 계약에 맞춘 것이며 새로운 업무 선택이 아니다. 동시 일정별 결과를 정규화로 숨기거나 전역 직렬화를 주장하지 않았다.

일반922pass/71skip, 실제PG54, 파일별 최종 Mongo833 및 type/build/lint를 확인했다. 개별 PG/native/API 검사는 중복 합산하지 않는다. 최초 전체 TAP 뒤 wrapper 오류를 보존하고 최종 영향 파일 결과로 교체한 집계 방식이다. 단일 최종 SHA의 전체 명령 exit0이라고 쓰지 않는다. 소유 합성 서버/데이터 정리는 완료했다. 독립 최종 수락·통합 상태는 independent-review/integration-review를 따른다.

Alignment outcome: update_next_task. 다음은 Calendar 저장/lease와 실제 backfill을 연결하는 별도 Task다. 외부 계획 draft는 `/private/tmp/hub-om-import-promotion-20260930/calendar-plan`에 있으며 선행 promotion 수락·통합 SHA 확정 뒤만 착수한다. lease/원본 부분실패/Google 응답 불명·요청당 효과와 기존 forward/reverse/cleanup/refresh 호출 범위를 별도 검토한다. 다음 범위를 크게 바꾸는 업무 결정은 현재 없다.

실원천·Drive·활동 쓰기/보존·backup/health·CLI/전체 앱 구성과 실제 A/B 백업·복원·최종 복사/전환은 남아 있다. 브라우저 임시 초안 암호화는 별도 후속이다. 실백업 증거0이며 dev→main 및 운영 전환 완료조건은 충족되지 않았다.
