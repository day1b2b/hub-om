# 시트 동기화 저장 경계

실행 범위: contract/Samsung sync, source 주입, PG 기본 및 Mongo 명시 context, 로그와 실제 API. 운영 연결·원천·키·main/dev 수정 제외. 기준 f3e80fe, 작업 feature/20260922-mongodb-coach-sheet-sync.

성공 기준: 기존 파싱·count·source ID·phase commit 계약, private 빈값만 보충, 수기 review 보존, 삼성 지정 course 전체교체/FK 의미 보존. dryRun은 업무/guard/change/log 쓰기 0. 권한 선행, scoped 누락 PG fallback 금지. 로컬 native 경합/롤백/암호화 검증과 전체 check, 독립 검토 후 feature commit/push.

R1-R6: 다중 writer·계약·민감정보·동시성·외부경계·검증 필요, Level3. parent의 catalog guard 확장과 Notion 제외 승인 유지. 추가 결정 없음.
