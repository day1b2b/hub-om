# 과정 관리자 전환 인계

- 격리 clone: `/Users/ga/workspace/hub-om-mongodb-coach-content`
- 작업 브랜치: `feature/20260929-mongodb-course-admin`
- 기준 총괄: `d964cb2559c080653f8dabf5713e0185f100214b`
- 승인 범위: 구현·실DB 합성검증·독립리뷰·feature push 및 총괄feature 통합. dev/main·운영 적용은 이번 범위가 아니다.

## 구현

관리자 과정 조회와 해당 과정 활성 운영 건 소프트 삭제를 courseAdmin repository/context로 연결했다. 기본 PG 쿼리·인증·응답을 유지하고 Mongo는 명시 shadow 주입만 사용한다. Company/Course/OperationSession/ActivityChange 기존 schema/codec/validator/index 재사용. 삭제자 암호화+HMAC과 삭제시각/updatedAt만 부분 수정하고 동일transaction 변경감사. 일반 운영 writer 경합 재시도 후 조건 재평가. 관계·기존삭제·다른과정·비관련raw암호문 보존, 재실행0.

코치 legacy 사용처 재확인: logProfileEdit는 PG 관리 adapter 전용이며 Mongo 프로필이력은 이미 존재한다. logReviewEdit 호출처 없음, Mongo평가 자체이력 구현. 반복구현하지 않고 coverage만 정정했다.

## 검증

Node24.19.0, PostgreSQL17.9(45migration), Mongo8.0.30 replica set, env -i, 새loopback/dbpath/합성자료·임시키.
- 최종일반888pass/33skip/0fail. opt-in skip은별도구분.
- 실제PG비교7pass/0skip/0fail.
- 신규native23pass/0skip/0fail.
- 기존Mongo묶음222pass/0skip/0fail(신규handler6 및 mock4 포함).
- handler/factory7 및 course묶음14는 위와중복이므로합산금지.
- typecheck/build PASS, lint0error·기존warning7. 최종추가test파일lint0/0.

실패유도는의도된검사이며전체rollback을검증했다. 실제112충돌·101업무/감사쓰기후실패원복, 201행/짧은BSONbatch/32MiB한도, 가상deadline15s/60s/재시도65s 확인. 자세한증거와한계는 execution-review.md.

## 남은 전체 작업

운영 기본은 PG다. 삭제 운영 목록/복원 등 운영 관리자 기능, 가져오기·OM접수배정·Calendar·공지·전역감사·관리DB/health 및 coverage의 남은 경계를 후속 전환한다. 실제복사·복구리허설·최종freeze/cutover·브라우저초안 암호화·dev→main은 미완료다. 운영/Atlas/실제원천·키·배포설정은 건드리지 않았고 자동화도 재개하지 않았다.

최종 독립리뷰, 자원정리와 commit/push/원격SHA·총괄통합은 integration-review.md에 확정 기록한다.

소유검증DB/프로세스정리완료: PG56619/Mongo27719 종료, dbpath2개제거. 로그만 /private/tmp/hub-om-course-admin-20260929/logs 에보존. 독립기능리뷰PASS. featurepush/총괄통합SHA는 integration-review.md 참조.
