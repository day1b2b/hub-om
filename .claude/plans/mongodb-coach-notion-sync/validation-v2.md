# Validation v2

구조: Core/조건분기/수락기준 존재. 독립 sql_review의 실제 정책 판독과 필수 반례를 반영한다.

V1 notionNo 우선, unkeyed 조건의 유무, phone OR birth 동일/이메일만 동일 비매칭, deleted earliest 포함 및 삭제표시 유지, 동일createdAt 새 tie-break 미도입.
V2 name/status/manual 관리필드 보존, regular truthy overwrite vs duplicate 빈값, employeeId 기존null유지, 신규profile생성, empty/duplicate tag 보존.
V3 catalog→coach→재매칭, Notion/시트/관리 identity와 private/tag 충돌·실제retry, source재호출0/count불중복, master유니크와실제충돌.
V4 행 내부 coach/profile/tag/audit rollback·다음행계속, all 단계별commit·부분실패·재실행, runlog상태.
V5 auth·scope(all 사전검사 포함)·source 주입 및 외부0/PG0, dryRun 업무/guard/log0.
V6 fieldHMAC 원문검증·birthDate decode비교·암호화·무관review보존·raw 오류 응답/errorDetail/log비노출.
V7 전체 일반/native/type/lint/build 및 독립 코드·실행 리뷰, 검사 미실행을PASS처리금지.
V8 문서·완료범위·feature push/원격SHA·정리, 전체운영전환 및 전체암호화완료 과장금지.

추가반례: 일반public도전부보존한다는오해금지, notionNo없는입력이기존keyed행에연결, 삭제행이live보다먼저매칭, 같은생일/다른전화 OR, 기존employeeId null미보충, late link/master/audit실패, all후속source실패이전commit유지.
