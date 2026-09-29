# 실행 중 발견과 보완

1. 계획독립리뷰: v1 Core 명세부족, v2 초기5갭. decision-rules와planv2 보완후독립최종계획PASS. 계획PASS와제품PASS 구분.
2. 조사probe: 임시PII키누락exit1→코드내random키설정후PG실측exit0. 잘못추정한파일경로는실제import/rg로정정, 제품검사실패아님.
3. 첫typecheck: env-i PATH에npm위치누락exit127→/opt/homebrew/bin 추가후exit0. Node24.19.0 우선PATH유지.
4. 첫native: Node strip-only parameter property unsupported, 실제DBtest미진입0pass1fail. 새Mongo생성자와기존SalesmapReader생성자를명시property할당으로변환(집계변경0). 재검증24pass0fail.
5. main경계검토: 3scope누락시notifier활성화전에전부preflight, exportedworkflow도raw예외고정코드화. 실제handler17pass,PG5pass/각132상황 확인. raw문구만의도적허용차이.
6. 독립Fermat P2검증공백: 전체deadline소진과최초pending이미목표(raw포함)유지. 실제112와가상단조시계누적으로기한소진, list후다른writercommit 이후pending유지/audit0 사례추가. Course/Company의 동일 snapshot경합·다른AAD암호문거부도보완. 제품코드는변경없음. 최종결과 execution-review.
7. 좁은test-name-pattern 실행은parent suite가선택되지않아실제case미실행(file-level pass1). 이를검증PASS로계산하지않음. 새case를포함한native 전체를별도실행한다. 전체Mongo묶음과중복합산금지.
8. 최종독립Turing P2 T15: 복수행fixture 표시명이동일해first행선택오류를놓칠수있음. 서로다른회사/과정명45번째상황추가, 원본PGquery와newPG/Mongo list반환을변경없이관찰해첫행이름exact검증. changes의이름·before/after/action연결도source구간별대조. 제품수정없으므로해당PG대조/type/lint만재실행, 전체회귀반복없음.

9. 커밋전staged diff검사가신규notifier의EOF빈줄1개로exit2, set-e로커밋/푸시중단. 해당빈줄만제거하고다시검사,파일digest갱신. 의미변경이없어제품검사반복안함.
