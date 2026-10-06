# Calendar 저장·잠금 경계 — 실행 계약

사용자의 반복된 계속 진행 승인에 따라 남은 기능을 수직 단위로 전환한다. 이번 사용자 흐름은 실제 가져오기 반영 POST → 기존 Calendar 보충 오케스트레이터 → 합성 Google transport → Mongo 연결 정보·감사 저장이다. 기본 PG와 기존 권한·메일·실패 후 잔존 상태를 유지하며, 만료 가능한 Mongo lease의 차이와 mapping 보호 범위를 구분한다.

기준: promotion 최종 `8238647961bebe3545128fc95f017881ace7d404`. 선행 제품504782b9f69a921df7b6ec1422dcf103514494e7과 기록 커밋을 작업·총괄에 atomic push하고 원격 SHA/clean을 확인했다. 선행 독립 코드·검증·문서·정리 수락 완료. 증거는 `/Users/ga/.cache/hub-om-verification/20260930-import-promotion/final-remote.txt`와 해당 계획 폴더다.

작업 clone `/Users/ga/workspace/hub-om-mongodb-coach-content`, branch `feature/20260930-mongodb-calendar-boundary`. 원본 workspace 수정 없음. 구현 전 전체 src/prisma/scripts 및 패키지·설정919파일을 `/private/tmp/hub-om-calendar-boundary-20260930/original`에 동결했고 원본 SHA manifest를 저장했다. oracle의 새 코드 의존 폐쇄 검사는 별도 필수다.

R1 규모(다중 포트·검증), R2 복잡도(잠금·외부효과·저장 조합), R3 불확실성(만료/ACK/경합 실증), R4 영향(기존 Calendar facade), R5 검증(원본 PG·native Mongo·API 상태), R6 재개/협업(독립 리뷰·증거·인계) 모두 해당하여 Level3 development-harness/validated-plan을 적용한다. 계획 논리 수락을 실제 검증 PASS로 취급하지 않는다.

대안 A는 저장·lease·실제 backfill 연결을 한 Task로 끝낸다. 대안 B는 lease만 별도 Task로 분리해 경합 검증을 줄이지만 종단 연결은 남는다. 현재 A를 채택하며 실제 알고리즘 반례로 조립이 불가능할 때만 재계획한다. 원본에 없는 Google exactly-once·전체 운영 writer fencing·무기한 잠금은 추가하지 않는다.

소유 합성 환경: `/private/tmp/hub-om-calendar-boundary-20260930`; PG17.9 loopback56749/calendar_boundary_parity; Mongo8.0.30 loopback27849 replica calendarboundary20260930. env-i/Node24.19.0, 임시 키·합성 데이터만 사용. 원격 Google/OAuth/Slack·실원천/운영DB/Atlas/키/env/배포/main/dev/자동화는 변경하지 않는다. 테스트 종료 시 소유 자원을 확인 후 정리한다.

새 업무 승인 질문은 현재 없다. 실운영 A/B 백업·복원·복사·전환은 미완료이며 dev→main 완료조건도 미충족이다. Resume action: continue_current_task.
