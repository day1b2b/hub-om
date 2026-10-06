# 독립 코드 조사와 범위 선택

2026-09-30, Volta/Sagan/Carver 읽기 전용 조사. 실행검증은 아직0.

Volta/Sagan: actual workspace guard, TOKEN??API_KEY와빈값 의미, databaseUrl→notionUrl→해당팀ID||URL(팀미설정시공통fallback없음), 전체pagination후mapper/JSONparser→빈행→sourceName→store 순서. properties없는page도NOTION-id행보존. alias첫nonempty/title삽입순서/date.slice10/formula0,false/미지원relation 의미, 후기page실패시staging0. sourceType notion·sourceSheet Notion·rowCount page수. rawstatusText오류는보안보완필요.

대안: Sagan은source/config동시주입을제안했고Volta는reader전체port를권했다. 부모는기존서버공유token/env선택을route에유지하고reader만주입한다. configport를추가하면평가순서/설정계약이확대되며현재사용자요청에scope별credential기능은없다. 실제환경을읽지않고env-i합성값만주입한다. 동시scopeA/B는동일한합성서버token을불변으로유지하며source/db/namespace만분리한다. env행렬은직렬또는별도worker에서복원한다. scope별서로다른token을지원한다고주장하지않는다. 정확한기본credential전달·body/Authorization을Notiontoken으로오용하지않음·토큰비저장은검증한다.

Carver: Sheets소스1050/증거45와staging증거33개hash일치. importstore/scan/codec/crypto/policy/contracts/명단/parser/validation/presenter/package/lock/schema/loader동일. HMAC/key/companion/cipher/부모/readiness/scan20k32MiB/15초·store60초하위행렬은재사용가능. 새Notion실POST의대표abort/callbackretry/commit후오류와pagination재호출0/추가run0/감사1을새검증한다. Calendar runtime변경이없으면scope3일반회귀로충분하며24전체반복은불필요하다. 실제NotionrawHTTP/property/parser/fulltuple/auth/env/error연결은반드시새검증한다.
