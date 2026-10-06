# Health 경계 — 범위 확인

목표는 현재 PG SELECT 1에 고정된 공개 GET /api/health를 명시 저장소 경계로 분리하는 것이다. 기본 PG와 HTTP 성공200/{ok:true,database:connected}, 실패503/{ok:false,database:unavailable,error}를 유지한다. 전체 앱 연결·DB schema 준비·복구 가능성·cutover 승인을 의미하는 health로 확대하지 않는다.

기준35104776c1ae4f42696d06e0e836ead29a786fb3, branch feature/20260930-mongodb-health-boundary, 격리 clone 기존 경로. 최신dev307f52f ancestor/원격 총괄3510477을 확인했다. 필수 문서는 이전 범위에서 읽었으며 변동 없음을 확인했고 CLAUDE/working-rules/db-write-safety/coverage/인계를 다시 대조했다.

실제 데이터·운영·키/env·권한·배포·main/dev·원본 workspace 변경은 없다. 새 의존성/업무필드/삭제 정책 없음. 새 소유 loopback PG56754/Mongo27854, root /private/tmp/hub-om-health-20260930을 확인 후 사용한다. 이전 Drive 자원은 종료·제거 완료라 재사용하지 않는다. 진짜 원천·Google·Notion 호출은 필요 없다.

열린 사용자 결정은 없다. 기존 개발·독립 검증·총괄 통합 승인으로 진행한다. 개발 환경에 노출되던 raw health 오류는 개인정보 비노출 목표에 맞춰 고정 오류로 제한하는 의도적 안전 보완이며 production 응답은 유지한다.

R1/R2/R4/R5/R6=1, R3=0, 5/6 Level3. 변경은 작지만 기존 API·연결 경계·공개 오류·전환 인계에 영향을 주므로 검증/독립 검토를 생략하지 않는다. 현재 source/public route는 인증과 활동 감사에서 의도적으로 제외되어 있으며 이를 바꾸지 않는다.
