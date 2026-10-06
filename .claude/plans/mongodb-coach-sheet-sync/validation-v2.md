# Validation v2 — 독립 검토 기준

sql_review READONLY 제안 반영. 구조: Core/조건분기/수락기준이 존재해야 결과평가 가능.

V1 권한 실패·scope누락·Notion/all 외부읽기 전차단. V2 parsing/count/sourceID/취소선/중복/연도/보조source실패 보존. V3 dryRun 업무·guard·변경감사·syncLog0 (요청감사별도). V4 신규identity/catalog 실제충돌·재시도. V5 삼성삭제predicate와 수기생성/과정변경 경합. V6 sortedlocks·이전/새/참조coach·source한번·retrycount불중복. V7 phase rollback과이전commit유지. V8 MANUAL삭제/empty삭제/Cascade/모든참조SetNull/취소이력/무관행·수기private/review보존/암호화/log lifecycle. V9 전체test/type/lint/build 및 실제native. V10 운영접속금지/문서coverage/featurepush/정리.

추가필수: cross-coach confirmed참조SetNull, 재실행시취소이력새engagement재연결없음, 계약manual review/hiringId실값보존, log finish실패 업무유지. catalog-before-read로 이전stale-read가없는경우 충돌+retry후최신값증명한다.
