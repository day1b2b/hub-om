# OM 회차 템플릿 API Mongo composition

2026-10-01 기준 `/api/om-request/session-template`을 `OM_SESSION_TEMPLATE_BACKEND` selector에 연결했다. 기본값은 PostgreSQL이며, 정확히 `mongodb-shadow`를 선택한 검증 context에서 기존 가져오기 템플릿용 request-audit runtime을 재사용한다. 템플릿 내용과 workspace 권한은 바꾸지 않았다.

실제 loopback MongoDB replica set에서 승인된 xlsx의 시트·헤더, 비인증 redirect, 성공·거절 요청 감사, actor 평문 비노출, PostgreSQL 접근 0건과 부분 namespace 무수정 거부를 확인했다. 파일 생성은 메모리에서 이루어지며 업무 데이터를 읽거나 쓰지 않는다. production selector 설정, 운영 shadow 복사·A/B 백업 및 복원, 최종 전환은 미완료다.
