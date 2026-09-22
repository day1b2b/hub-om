# Coach schedules boundary
목표: 기존 운영 PostgreSQL 선택을 유지하면서 지정된 세 API의 코치 일정/예약 흐름을 명시 Mongo shadow scope에서 실행·검증한다. 실행 포함, feature branch push 허용. 운영/실데이터/배포/환경키 수정 금지.
기준 cc9eeb49e3e6792c560b9c448527d2069e9603a8, clean isolated clone /tmp/hub-om-coach-schedules-20260922.
R1–R6: 다중 API/계층, 동시성, 변경감사/암호화, 인증, 사용자 계약, native 검증 모두 관련: Level3.
수락: 기존 DTO/auth/access log/confirmed schedules/self cancellation 유지, 실제 날짜 검증, 경합시 단일 최종 승자, 다중쓰기+변경감사 원자성, 누락scope failclosed, 실제handler Mongo8 + 전체회귀/타입/lint/build, 독립리뷰.
범위밖: engagement 쓰기/동기화/실데이터전환/생산selector. 기존 월 가용일정 replacement는 established contract이며 예약은 cancelledAt soft cancel 유지. 별도 삭제정책/스키마를 창작하지 않는다.
