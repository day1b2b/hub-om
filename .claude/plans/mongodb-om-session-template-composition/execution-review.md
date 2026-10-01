# OM 회차 템플릿 composition 실행 리뷰

- 범위: `/api/om-request/session-template` GET의 저장소 선택 경계
- 선택: 기존 `openMongoImportTemplateRuntime`의 `requestActivity` 단일 scope를 재사용하고 기능별 selector만 분리했다.
- 보존: PostgreSQL 기본값, workspace 권한, xlsx 파일명·시트·헤더·예시 데이터
- 검증: selector 단위 6건, 실제 Mongo route 1건
- 전체 회귀: 1533개 중 1360 pass·173 skip·0 fail, typecheck·build 통과, lint 오류 0·기존 경고 7
- 실제 Mongo 확인: 정확한 UTF-8 파일명·시트·헤더·예시 행·10개 입력 행, 성공·비인증 redirect 요청 감사, actor 평문 비노출, PostgreSQL 접근 0건, 부분 namespace 전후 전체 snapshot 동일
- 미완료: production selector 설정, 운영 데이터 복사, A/B 백업·복원, 최종 전환
