# 매출 동기화 실행 매니페스트

시작 a52f191f0f5ffd6aeb805eea8e040ab78196eb6c, feature/20260929-mongodb-sales-revenue-sync, 기존변경없음. 원본workspace수정없음. 계획v2 독립수락후candidate제품반영.

제품: salesRevenueSyncRepository(interface), prismaSalesRevenueSyncRepository, factory, dataRepositoryContext의3port, salesRevenueSync(facade+workflow), mongoSalesRevenueSyncRepository, salesRevenueNotifier, salesRevenueSourceIssues, 실제sales-revenue/route. 공유금액helper mongoNumericMoney를기존admin에서분리하며admin오류코드유지. SalesmapReader생성자는Node strip호환property선언만변경. source집계/캐시/페이지/업무필드/권한/schema/dependency변경없음.

검증: salesRevenueSync.test(실defaultsource는합성fetch,기본notifier는합성lookup/send), mongoSalesRevenueSync.integration.test(native경합/rollback/암호화), mongoSalesRevenueHandlers.integration.test(actualGETPOST), salesRevenueSyncOriginalOracle.fixture(기준에서IO만주입)+salesRevenueSync.postgres.integration.test(45상황×3phase×3backend). 원본checksum은test내고정. DB코드실행은모두main, agent는초안/독립검토만수행했다.

Step1: 조사/원본fixture/금액PG실측완료. Step2/3 규칙과Step4제품구현완료. Step5실PG5pass/각135phase,actualhandler17pass,초기native24pass/source4pass,일반910pass57skip/type/build/lint검사완료. 독립testgap보완후최종native28/전체Mongo577pass확인,세부상태execution-review참고. Step6/7문서/정리/통합/최종수락은아직실행증거필요.

문서: 본계획디렉터리, operations/mongodb-sales-revenue-sync.md, runtimecoverage/macro/cutover-remaining 갱신예정. 최종파일명단은기준commit대비gitdiff+untracked를재대조한다.
