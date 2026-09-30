# MongoDB 공지·첨부 runtime

공지 목록·상세·작성·수정·소프트 삭제와 첨부 다운로드를 요청 감사와 같은 명시 Mongo shadow runtime으로 조립한다. 기존 repository·권한·multipart·감사 계약을 유지하며 생산 backend selector는 추가하지 않는다.

## 포함 포트

- `announcements`
- `requestActivity`

두 포트는 호출자가 빌려준 같은 `MongoClient`, database, namespace를 사용한다. 공지 업무 감사는 공지 repository의 트랜잭션에 포함되고, 요청 감사는 기존 `withActivity` 계약대로 응답 이후 best-effort다. 요청 감사 실패가 성공한 공지 업무쓰기를 되돌리거나 PostgreSQL로 fallback하지 않는다.

## 준비와 재실행

`prepareMongoAnnouncementRuntime`은 정확한 namespace에 알려진 runtime collection이 하나도 없는 새 shadow에서만 request audit과 공지 validator·index·guard를 준비한다.

- 준비된 namespace는 mutation 없이 두 repository의 전체 readiness만 확인한다.
- 부분 준비·다른 runtime 모델·오래된 정책이 있으면 자동 수리·삭제하지 않고 고정 오류로 실패한다.
- `openMongoAnnouncementRuntime`은 준비 작업과 client 종료를 하지 않는다.
- 등록된 runtime 객체 하나만 떼어 만든 반쪽 scope는 callback 시작 전에 차단한다.

## 확인한 범위

새 로컬 MongoDB 8.0.30 replica set과 합성 키·데이터에서 실제 API·페이지를 통해 다음을 확인했다.

- 관리자 인증과 4개 공지 페이지
- 목록·상세·작성·수정·소프트 삭제
- multipart 오류, 파일 5개·개별 5MiB 경계, 원문 byte 다운로드
- 업무 감사와 요청 감사의 암호화·귀속
- 요청 감사 실패 후 업무쓰기 보존과 고정 로그
- 준비된 namespace 재실행·open의 mutation 0
- 다른 runtime 모델만 있는 부분 namespace의 자동 수리·삭제·mutation 0
- 등록 scope 분해·중첩 전환 차단, 미등록 반쪽 scope의 누락 포트 차단
- PostgreSQL fallback·외부 요청 0과 borrowed client 유지

실제 운영 namespace·권한·부하, 브라우저 전체 흐름, production selector·배포, 실제 데이터 이전·백업·복원·최종 전환은 확인하지 않았다.
