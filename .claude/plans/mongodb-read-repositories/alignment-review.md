# Alignment Review

판정: update_next_task.

이번 Task(Team/Coach 조회 10개)는 구현·mock 기준 대조·7.0.43 실제 합성 엔진·독립 검토 15기준 통과로 완료했다. 전체 MongoDB 이전 Wave는 진행 중이다.

계획 변경 근거: Operation의 기존 모델 집합을 전역 확대하지 않고 도메인별 준비를 분리해 기존 생성 기능 회귀를 방지했다. Mongo8.0의 호스트 커널 기동 문제는 운영 커널 변경 대신7.0 보조 엔진으로 분리 검증했다. 8.0 운영 대상 검증 면제는 아니다.

적용: plan-v2/validation-v2, 실행 기록, 공개 운영 문서, handoff를 갱신했다. 실제 엔진에서 드러난 합성 고유키/URL 설정 문제는 test만 수정하고 native로 재확인했다. 새 제품 동작·권한 정책 결정은 없다.

검증: 최종 전체789pass/7skip, 타입/빌드 통과, lint0error/기존7warning. 실제 엔진 검증은 native7b에서 Operation/Team24pass 및 수정된 Coach native/mock2pass, 최종 보안확장 native1pass로 구분하며 중복을 더하지 않는다.

잔여: 운영 목표 버전, 실제 PG 엔진과 동일 데이터 대조, 실제 복사·복원·동결·cutover, 아직PG를 사용하는 업무쓰기/API. 로컬GitHub DNS 제한으로 원격 push/merge는 수행하지 못했다.

다음 권고: 운영 factory를 유지하며 Coach/Team 쓰기 및 InstructorNote 등 남은 직접 DB 접근을 도메인별로 전환하고, 승인된 운영 Mongo 환경에서 이번 조회 검증을 반복한다. 실제 복사는 parent 환경 allowlist와 source mode를 확인한 독립 job으로만 진행한다.
