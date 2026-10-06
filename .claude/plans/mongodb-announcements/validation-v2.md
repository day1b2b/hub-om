# 공지·첨부 검증 v2 — Anscombe

독립critic 구조조건부PASS, 구현실행PASS아님. S1좁은repository/명시context/defaultPG/6handler+3조회page+작성page. S2부모·첨부·감사원자화,기존preflight분리·삭제/상한계산유지. S3기존분리codec·실PG원본oracle·nativeByte최대실행. 구조FAIL시결과평가중지.

V1 실제assert/requireAdminSession/withActivity,익명·외부·일반직원거부와관리자허용,세션actor,기존예외/redirect보존. scope/requestrepo누락선행차단,후행request감사실패업무성공·고정로그·noPGfallback.
V2 titletrim/HTMLsanitize/빈본문/File만/MIME기본,0/5/6파일·0/5MiB/5MiB+1,201/200/400/404와문구/잘못된multipart예외보존. 새형식/총용량정책금지.
V3 모든공지·첨부·제거ID UUID표기실PG대조,무효≠정상부재,no trim. list시간desc/file시간asc,DTO/ISO/nullable작성자,동률_id허용. deleted모든사용자조회배제.
V4 원본PG생성/수정/혼합첨부/softdelete,작성자·createdAt·남긴첨부cipher보존,부모밖첨부삭제불가. removeIDs.length의중복/외부/부재계산유지. 동일PUT updatedAt/감사대조,추가PUT멱등성신규요구없음.
V5 5x5MiB비텍스트합성bytes생성→상세/편집→정확download→제거교체. nativeBinary subtype/실BSON크기검증. embedding/JSONBuffer금지. 추정첨부8.89MiB(9.32MB)는실측대체불가.
V6 실제BSONshort/실마지막_idkeyset/noGetMore,full인증후metadata만보관. list32MiB/첨부전용64MiB/20k행/15s한도·초과부분결과금지. Bytes Object.entries/sort/거대JSON비교금지. 최대fixture시간/RSS/환경기록,운영부하보장아님.
V7 title/content/author/deleter/filename/data와감사actor raw평문없음. 키누락/불일치·HMAC·암호문/Bytes손상failclosed/무쓰기. 다운로드부모활성+소속snapshot,bytes/ContentType/UTF8disposition한글특수문자정확.
V8 PGtrigger action/target/필드/actor parity. 공지공개없음,첨부announcement_id/mime_type/size만공개. PII동일HMACskip/nullableINSERTDELETE부재와null. 후행첨부/감사실패전체rawHMAC시간감사원복,ActivityRequest별도.
V9 actualwriter/barrier PUTPUT/PUTDELETE 양선행,실conflict/retry,승자고정불필요. stalePUT후deleted상태유지하며content변경가능,부활/작성자유실/무관삭제/중복감사불가. concurrent첨부5초과기존한계보존. 다운로드/삭제는snapshot파일전체또는404.
V10 actual6handler와목록/상세/편집/작성page,UI만stub,empty/loadFailed/notFound/작성자fallback/날짜·크기/link/sanitize/Form초기props/mode. repo mock만으로대체불가.
V11 SHA고정원본query/nestedwrite/DTO독립oracle,ID시간제외명시,랜덤cipher backend동일요구금지. 30s retry/15squery/codec감사후deadline,가상과실시간구분. openreplica/shadow/validatorindex무수리. 전체검사/독립리뷰·실패skip·정리pushSHA통합별도.

계획보완필수: 공통32MiB확대금지/첨부전용64MiB,Bytes비교와첨부allowlist명시,nullable감사실PG대조후두모델최소보완. 브라우저/OAuth/운영부하는미실행한계.

## 메타 반영과 critic 수락
V5 최대5x5MiB/BSON실측/roundtrip필수,시간/RSS는관찰값만. V6 실제최대/BSONshort/keyset/noGetMore는필수,모든32/64MiB·20k실경계의대형fixture는필수아님. 안전한도계측주입검증허용,미실행실경계명시. V9 동일부모실쓰기경합충돌/retry증거필수,preflight404까지강제안함. Anscombe메타반영수락,기준완화가아닌증거수준명확화.
