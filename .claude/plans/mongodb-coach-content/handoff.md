# 코치 콘텐츠 전환 인계 — 2026-09-29

## 재개 위치

- 지속 clone: /Users/ga/workspace/hub-om-mongodb-coach-content
- 기능 branch: feature/20260929-mongodb-coach-content
- 기준 총괄 branch: feature/20260922-mongodb-parallel-transition
- 기준 HEAD: e1b97490eeded7cf34dc9c3e491fa3c4ef1d7235. 종료 전 fetch에서도 총괄 동일함 확인.
- 이 문서를 포함하는 기능 커밋을 사용한다. 최종 원격 SHA 일치는 종료보고에서 확인하며 재개 시 원격 branch와 `git rev-parse HEAD`를 다시 대조한다. 기존 9/23 임시 clone은 재사용하지 않는다.

## 이번 범위

메모 CRUD·경고/이력·콘텐츠피드·월등록현황/status·admin page 삭제수를 명시 Mongo 저장 경계로 구현·검증했다. 기본은 PG다. 실제 PG 대조로 발견한 콘텐츠 감사 표현과 공유 scan의 다중페이지 문제도 보완했다. schema/dependency/운영 selector/권한·삭제정책 변경 없음.

일반877pass25skip0fail, Mongo165pass0skip0fail(mock4포함), PG/Mongo비교7pass0skip0fail. 서로 합산하지 않는다. typecheck/buildPASS, lint0error/기존7warning. 최종 독립리뷰PASS, 미해결 코드 차단지적 없음. 상세근거 execution-review.md 및 execution-manifest.md.

## 환경·정리

Node24.19.0, PG17.9, Mongo8.0.30, env-i/임시키/합성fixture만 사용했다. 소유 Mongo27679/PG56579 인스턴스는 정상종료했고 /private/tmp/hub-om-content-20260929/{mongo,pg} dbpath는 삭제했다. 검증로그/checks.sh는 같은 root에 보관했다. Mongo 실행파일 /private/tmp/mongodb-macos-aarch64--8.0.30/bin/mongod 및 배포압축파일은 유지했다. 다음 검증은 새 dbpath/포트/키를 사용한다.

## 다음 담당 작업

총괄이 feature commit을 통합하고 변경 기준으로 통합 회귀를 확인한다. 이 작업에서 총괄 clone·main/dev는 수정하지 않았다. 다음 기능은 coverage 기준으로 coachMyPage/토큰backfill 등 남은 코치경로 또는 별도 관리자·가져오기·공지 흐름 중 수직단위를 선택한다. 프로필/후기 legacy helper의 PG 경로도 문서대로 남아 있다.

전체 앱·브라우저초안·운영데이터 암호화나 운영이전은 완료되지 않았다. 실제 PG backfill·복사·복원리허설·생산selector·health/배포 및 캘린더·활동·관리 기능들은 별도다. 실제원천/운영DB/Atlas 접근이나 env·키 변경은 수행하지 않았다. 과거 dev→main 요청을 이 feature 검증 완료만으로 실행하지 않는다.

기존 PG/Calendar 일부 opt-in 검사는 이번에 재실행하지 않았으며 PASS로 처리하지 않았다. OAuth실로그인/브라우저전체시각/실운영collation·부하 검증도 미실행이다. 이 한계는 execution-review에 보존한다.
