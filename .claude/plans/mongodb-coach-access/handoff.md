# 후속 실행 계약
위치: /tmp/hub-om-mongodb-20260922, feature/20260922-mongodb-parallel-transition. Level3. 원본workspace dirty 보존.
Task: 코치 링크 인증·본인조회·개인정보 export·재발급 경계 구현 및 native 검증. 최종review/보관 단계. 전체Initiative/Wave는 진행 중.
검증: execution-manifest와execution-review. 최신825pass15skip, Mongo8묶음33pass(mock4포함), 타입/build통과, lint오류0/기존7warning.
읽기: macro-plan → plan-v2 → execution-review → manifest → gap-plan → docs/operations/mongodb-runtime-coverage.md.
Do Next: 코치 월간 일정/예약 API와저장소를 구현·검증하고 독립리뷰 후 통합. 기존 Mongo담당 task로인계하고총괄자동확인이실제최신결과를검토·다음일감을진행하도록갱신.
Do Not: 전체코드완료전생산selector변경,운영DB/키/배포조기변경,개인정보실데이터사용,원본미커밋파일변경,사용자침묵을새정책승인으로간주.
Resume: start_next_task. 코드통과와featurepush보관, 운영미반영을구분. 새로운실제운영조치가필요하면대상과절차를사용자에게안내.
