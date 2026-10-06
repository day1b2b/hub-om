# Calendar 경계 인계

기준8238647961bebe3545128fc95f017881ace7d404, branch feature/20260930-mongodb-calendar-boundary, 별도 clone hub-om-mongodb-coach-content. 구현·합성 실행·독립 코드/증거 리뷰 수락 및 소유 자원 정리를 마쳤다. 원격 통합의 최신 상태는 integration-review.md를 먼저 확인한다. 이 Task의 계획 R1~R6 Level3 수락이며 후속 Drive 계획의 요구사항과 혼동하지 않는다.

완료 범위: Calendar 저장/시각 port와 원본PG delegate, 명시Mongo8port 구성·누락/혼합/nested preflight, 서버시간 lease와 mapping/감사 원자성, 실제promotion→backfill→합성Google, forward/reverse/cleanup/refresh·부분실패·재실행, touched 오류/로그 비노출. 기본PG·권한·메일선택·기존삭제정책 유지. PG와 달리 실제정지에서Mongo lease가만료하는 차이, mapping외writer미보호·외부효과잔존·오답HMAC miss한계는 execution-review와공개문서에기록했다.

검증: 일반954pass77skip, PG5pass0skip, 전체Mongo963pass0skip(기존mock4포함), typecheck/build통과·lint0error기존7. 전체 뒤 adjacent 테스트 단언만 강화해12pass별도확인; 제품동일hash,중복합산금지. 최종독립제품 Confucius/증거·PII Carver의 열린 지적없음. 실행·한계·실패보완은 execution-review.md와execution-manifest.json.

소유PG56749/Mongo27849를종료했고 dbpath pg/mongo만제거했다. 포트닫힘·PG activeclient0/publictable0·Mongo testDB0확인. 빌린Mongo바이너리는보존. 내구증거 `$HOME/.cache/hub-om-verification/20260930-calendar-boundary/`,47개초기증거hash검증과verified-code-digests.json. 이증거의복사본/문서작성은실A/B백업이나운영복원증거가아니다.

Do Next: 원격통합상태확인→다음Drive 저장이력조회와기존결과페이지의계획확정→별도작업branch에서원본PG/native/page검증포함구현. 사전계획초안은임시root의 next-drive-history-plan/에있고현재Calendar저장소코드와분리되어있다. 후속은새소유DB/namespace/임시키를쓴다.

Do Not: 이미완료한sourceID암호화·승격·Calendar경계를새미전환작업으로반복,원본workspace·main/dev·운영DB/Atlas·실원천/Google·키/env/배포·자동화변경. Drive dry-run CLI는run/result를실제쓰므로조회완료로writer완료처리금지. 전체앱·CLI/job 조립·실원천·backup/health·실A/B백업/복원/최종복사/무손실복귀·운영전환미완료이며dev→main조건미충족. 브라우저초안암호화는별도후속이다.
