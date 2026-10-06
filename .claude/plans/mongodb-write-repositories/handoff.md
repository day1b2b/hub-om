# Handoff

- Initiative: PostgreSQL운영을유지하며MongoDB암호화검증후전환.
- Macro: ../mongodb-read-repositories/macro-plan.md; 현재Wave 전체runtime전환은in_progress.
- Task: 이번MongoDB shadow코치CRUD/팀명단생성수정/강사노트저장 complete. Level3. Team삭제정책은gap으로명시.
- 위치: /tmp/hub-om-mongodb-20260922, feature/20260922-mongodb-parallel-transition. 원본workspace변경금지.
- 읽기순서: macro → plan-v2 → execution-review → execution-manifest → gap-plan → runtime coverage.
- 완료: 3repository/전용setup·guard/합성test·독립review·문서. 입력화면이나현재운영저장경로는미변경.
- Verification: 로컬800pass10skip, lint0error기존7warning, type/buildpass. Mongo7.0.43실엔진신규3suite pass0skip; 전체suite생략수와합산금지.
- Validation: 기존DTO및필드누락보존/원자실패취소/정규화중복동시등록방지/동명이인NO의미. 실제PGquery및생산UI는아님.
- 증거: execution-manifest, execution-review, /tmp/hub-write-{all-tests,type,lint,build}.log, 서버 /tmp/hub-om-shadow-write-w924k7/native-writes.log.
- Open gaps: Team삭제contract,64실제PG호출파일·간접활동/권한/Calendar,8.0검증,실제복사/복원/전환,push연결.
- Alignment: update_next_task,문서적용완료.
- Do Next: CoachCRUD/APIprovider경계와전체쓰기경로계약을차례로전환준비. Nativeguard는모든writer참여가출시조건.
- Do Not: 현재factory조기Mongo선택,운영DB/키변경,평문spool,원본dirty파일변경,7.0결과를8.0/배포완료로보고.
- Resume: start_next_task.

- 임시자원: 이번w924k7 합성DB0/컨테이너0 확인, 서버증거로그/소스보관. 새작업시새합성컨테이너필요.
