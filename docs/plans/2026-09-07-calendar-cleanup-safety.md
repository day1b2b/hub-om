# 캘린더 소급 일정 정리

정리 기능은 새 생성 경로가 `hubOmCreationSource=backfill`과 생성 식별자를 남긴 이벤트만 대상으로 한다. 이전 이벤트의 출처를 일정 제목·날짜로 추정하지 않는다. 기존 중복 일정이나 출처 없는 이벤트를 자동 삭제하는 도구가 아니다.

## 실행 계약

기존 `/api/admin/calendar/backfill-events`의 관리자 세션 또는 서버 인증을 사용한다.

1. `GET ?mode=cleanup&operationIds=fixture-operation`으로 삭제 미리보기를 조회한다. 회차 ID 1~20개, 이벤트 최대 100개다. 이 호출은 Google 일정과 DB를 변경하지 않는다.
2. `candidates`에서 실제 정리할 이벤트를 선택한다. 각 후보의 `token`은 회차·매핑·Google 버전과 15분 만료 시간을 서버 비밀키로 서명한 값이다. `AUTH_SECRET` 또는 기존 `NEXTAUTH_SECRET`이 없으면 미리보기 서명을 거절한다.
3. 같은 경로에 `DELETE`와 JSON `{ "tokens": ["선택한 후보의 서명 토큰"] }`을 보낸다. 회차 ID만으로 삭제할 수 없다. 정상 일정은 별도로 선택하더라도 출처 검증을 통과하지 못한다.
4. `ok`, `deletedEvents`, `failedEvents`, 각 `outcomes`를 확인한다. Google 삭제 후 DB 정리가 실패하면 `googleDeleted=true`, `ok=false`이므로 실제 Google 삭제 수가 숨겨지지 않는다.

선택 뒤 회차·매핑·Google ETag가 바뀌면 삭제하지 않는다. Google DELETE에도 If-Match를 전달해 조회 직후의 변경까지 보호한다. source 표식 변경도 거절한다. 임의 복원 또는 자동 재생성은 하지 않는다. 모든 매핑이 없어진 회차는 일반 수정만으로 다시 캘린더에 생성되지 않으며, 재생성이 필요하면 별도의 소급 생성 미리보기를 검토해야 한다.

## 재시도와 한계

Google 삭제 후 DB 정리가 실패하면 같은 토큰으로 재시도한다. 만료된 토큰으로 새 Google 삭제는 불가능하다. 다만 Google 이벤트가 이미 없고 원본 회차·매핑이 그대로인 경우에는 남은 매핑 정리만 허용한다. 이벤트 404/410을 처리할 때 캘린더 쓰기 권한도 확인하므로 접근 권한 상실을 삭제 성공으로 처리하지 않는다. 권한을 확인할 수 없으면 매핑을 보존하고 실패한다.

Google와 DB는 하나의 원자적 트랜잭션이 아니다. 부분 실패는 응답에 남고 재시도가 필요하다. 서로 다른 서버의 앱 작업은 PostgreSQL 세션 잠금을 공유한다. 저장소를 우회하는 외부 DB 쓰기나 구버전 서버는 이 잠금을 사용하지 않는다. 롤링 배포 중에는 정리 기능을 실행하지 않는다.

기본 소급 정리는 `sendUpdates=none`을 사용한다. Google 공식 계약상 외부 참석자 캘린더의 동기화를 보장하지 않으므로 메일 억제와 외부 캘린더 반영을 같은 의미로 보지 않는다.

## 검증과 데이터 영향

가짜 Google API, 익명 fixture, 별도 localhost PostgreSQL에서 생성·삭제·재시도·잠금 경합·서명 변조·권한 거절·오래된 계획을 검증한다. 실제 운영 데이터, Google 일정, 운영 스키마 또는 배포 설정은 검증을 위해 변경하지 않는다. migration은 없다. 운영에서 실제 정리를 실행할 때는 `docs/operations/db-write-safety.md`의 대상·백업 확인 절차를 따른다.

- Google 조건부 변경: https://developers.google.com/workspace/calendar/api/guides/version-resources
- Google 생성 ID·알림: https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
