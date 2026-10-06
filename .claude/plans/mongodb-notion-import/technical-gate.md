# 원본 PG 관찰 gate

부모가 Node24.19/env-i, PG56752 notion_import_test의 frozen원본093f585로실행했다. logs/pg-gate.log: root1pass/0skip/0fail/exit0, 내부22관찰, cleanupremaining0. wholeparity수락아님.

token없음/빈TOKEN은JSON보다먼저설정400, TOKEN/API_KEY/공백token선택·팀설정fallback·compactID우선순위를확인했다. sourceName숫자정상결과는읽은뒤trimTypeError, 빈결과는빈행400우선. properties없는page도ID행저장. header1/row2, formula0/false 문자열, 날짜slice와정규화, rowCount/저장·감사·검토DTO/암호화raw를수집했다. finishedAt이PGstartedAt보다6ms앞설수있으므로순서강제금지.

관찰한계: gate의malformed-eager-title은앞선유효title이먼저반환되어성공했다. 이case이름만으로eager실패를입증하지않는다. V3별도fixture는Course rich_text와뒤null property를써title탐색이null까지도달하도록하고, 유효title이먼저면성공하는기존shortcircuit도구분한다. 원본관찰을맞추려고제품이나동결gate를수정하지않는다.
