# Handoff / Resume

- 상위 계획: macro-plan.md.
- 위치: feature/20260922-mongodb-parallel-transition, /tmp/hub-om-mongodb-20260922. 원본 /Users/ga/workspace/hub-om의 미커밋 상태 보존.
- 상태: 이번 조회 Task complete; 전체 런타임/운영 이전 Wave in_progress. Level3, handoff-ready.
- 읽기 순서: macro-plan → plan-v2 → execution-review → execution-manifest → gap-plan → docs/operations/mongodb-shadow-job.md.
- 완료: reviewed09e3b72 통합, 조회3repositories(10methods), 도메인별 준비, 복사 전용 image/환경 분리, 합성 검증/독립 리뷰.
- 검증: 전체789pass7skip, lint0/기존7warning,type/buildpass; Mongo7.0.43 native Operation·Team·Coach 및 키변조/구키/격리/읽기쓰기0검증. Dockerjobimage buildpass/noargsfailclosed.
- 검수: 기존 화면계약의10개 DTO/필터/정렬과 개인정보 보존을 같은mock reference 및 실제Mongofixture로 확인. 실제PG쿼리대조는 아님.
- 잔여: 8.0 kernel문제, 원격push(DNS불가), runtime나머지, 실제PG→Mongo복사/백업복원/최종동기화/배포. 운영factory불변.
- 임시 자원: 서버 /tmp/hub-om-shadow-read-7hgrdx에 합성 로그/소스 및 image hub-om-shadow-check:7hgrdx 보관. 합성DB잔존0, label hub-om.synthetic=7hgrdx의이번컨테이너3개정리완료, 실행중검증프로세스없음. 실제서비스영향없음.
- 운영 설정: Coolify저장설정은pending; 현재운영container에서는DATABASE_URL만존재하고MongoURI/PII3개/새exporttool없음을Boolean로확인했다. 저장값을실행환경적용으로오해하지말것.
- Alignment: update_next_task, 문서갱신완료.
- Do Next: 잔여Coach/Team쓰기/API를작게선정, 원격연결가능시featurecommit push; 실제copy는원천모드와환경allowlist확인후독립job준비.
- Do Not: 운영앱재배포로키만적용하거나부분Mongo factory로조기전환하지않는다. 운영PG쓰거나반출평문spool생성/키출력/실제데이터테스트혼입금지.
- Resume action: start_next_task.
