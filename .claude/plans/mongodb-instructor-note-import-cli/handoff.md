# 강사노트 파일 가져오기 CLI 인계

- 작업 브랜치: `feature/20261001-mongodb-instructor-notes-import-cli`
- 기준 총괄 SHA: `73c99990f1473a32f8c7ab8d86d4eef378dd6f8a`
- 제품·검증 SHA: `ae5fab451c7411bbbaf9bf4408a6e12813265701`
- legacy raw pg import를 기본 encrypted PostgreSQL/명시 prepared Mongo shadow repository로 교체했다.
- 암호화 로컬 원천, 숫자 key/Notion NO와 구형 이름 key를 지원한다. PII 제거, 비어 있지 않은 값만 덮어쓰기, recruitAvoid OR, dry-run과 단일 transaction rollback을 유지했다.
- 로그에는 강사명·메모·원천 경로·오류 원문을 출력하지 않는다.
- 최종 검증은 일반 1,129 pass/118 skip, 실제 Mongo 가져오기 1 pass·Notion 회귀 25 pass, 실제 PostgreSQL 1 pass, typecheck/build/lint와 독립 리뷰를 통과했다.
- 운영 실행·실제 `.local` 원천·키·설정은 건드리지 않았다. production selector, 전체 앱, 실제 백업·복원·복사·최종 전환과 `dev → main`은 미완료다.
