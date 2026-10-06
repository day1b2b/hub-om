# 실행 기록

기준 HEAD af743c8, feature/20260922-mongodb-parallel-transition, 원본 사용자 dirty workspace 보존.

- Coach: mongoCoachWriteRepository{,.test,.integration.test}.ts와 mongodb-coach-writes.md. 생성/프로필+private+태그 수정/상태/softdelete/같은transaction content audit.
- TeamUser: teamUsers/mongoTeamUserRepository{,.test,.integration.test}.ts와 mongodb-team-user-writes.md. 명시 준비된 내부 guard로 정규화중복/동시수정 직렬화. delete 차단 gap.
- InstructorNote: mongoInstructorNoteRepository{,.test,.integration.test}.ts와 mongodb-instructor-note-writes.md. 기존 5개메서드, 부분갱신+PII처리+unique경쟁.
- 남은경로: mongodb-runtime-coverage.md, 실제 PG직접호출64파일 및 간접기능18군.

## 실제 실행

- 로컬 전체 npm test: 810개 중800pass/10skip/0fail, /tmp/hub-write-all-tests.log.
- npm run typecheck pass: /tmp/hub-write-type.log.
- npm run lint 오류0·기존경고7: /tmp/hub-write-lint.log.
- npm run build pass: /tmp/hub-write-build.log.
- git diff --check pass. 생산 app/routes/schema/package/factory diff없음.
- 실제 MongoDB 7.0.43 replica set에서 신규 native suite3개 전부pass/0skip, 1413.620209ms. 운영과격리 --network none Mongo를테스트컨테이너와loopback공유, 랜덤합성키/데이터만사용. 코치관계·감사rollback/공유tag동시생성, TeamUser중복·갱신·batchrollback, InstructorNote unique경쟁·부분갱신·변조 및키누락확인.
- 서버 /tmp/hub-om-shadow-write-w924k7/native-writes.log, exitcode0. 기존검증이미지 hub-om-shadow-check:7hgrdx에 신규9파일만readonly bind.
- 전달9파일archive SHA256 e4167d613560663a47da623ba6c41c3a31ed551364891d7f226a35af39a66a97 서버일치.
- 신규테스트의 최초로컬실행에서TS parameter property strip-only 에러발견→일반필드선언으로보완후통과. 독립리뷰에서Instructoropen오류원문노출발견→일반화+반례테스트추가후통과.

## 미검증

실제 PG쿼리대조, 대상Mongo8.0, 전체runtime연결, 실제운영복사/복원/전환. mock transaction은native원자성근거로사용하지않음. 신규native3pass를전체로컬10skip과합산하지않음.

정리 확인: 실제Mongo7.0.43에서 remainingSyntheticDatabases=0. label hub-om.synthetic=w924k7 확인 후 이번 Mongo컨테이너 stop/rm, 해당label 잔존0. 테스트컨테이너는 --rm 종료. 로그/합성소스만 보관. 원본 workspace의 기존 dirty 상태 재확인·동일.
