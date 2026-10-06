# PostgreSQL runtime preflight 검증 v1

## 완료

- 단위 테스트: compatible, UTC/encoding/ordering 불일치 blocked, 실패 시 rollback/close와 오류 비노출
- 타입 검사: 통과
- 실제 격리 PostgreSQL 17: C locale, UTF8, 앱 UTC 세션에서 `compatible`, 종료 코드 0
- 실제 격리 PostgreSQL 18: C locale은 `compatible`/0, ICU `ko-KR`은 byte ordering만 false인 `blocked`/2
- URL `options`로 read-only를 끄려는 실행은 연결 전에 고정 오류/1로 거부
- 비동기 driver error, end reject, end timeout은 고정 오류로 실패하고 원문을 노출하지 않음
- 세 합성 검증 DB의 사용자 테이블: 0
- 합성 DB와 임시 파일: 종료 후 삭제

## 독립 리뷰 1차 보완

- URL의 `options`가 코드 startup options를 덮어쓸 수 있다는 P1: 모든 대소문자 `options` query를 연결 전에 거부
- 비동기 `error` event가 Promise catch를 우회한다는 P1: connect 전에 listener를 설치하고 cleanup 후 고정 실패로 판정
- 10개 probe의 과대 해석 P2: probe와 함께 provider `c`, collate/ctype `C` 또는 `POSIX`를 필수화하고 문서 표현 제한
- end 실패/정체 P2: 실패를 성공으로 숨기지 않고 최대 5초 bounded cleanup 후 고정 실패

## 아직 확인하지 않음

- 실제 운영 PostgreSQL의 collation/TZ/version: 운영 접근 금지 때문에 미실행
- C가 아닌 실제 운영 collation에서의 기능별 parity: 운영 결과가 blocked일 때 별도 합성 재현 필요
- 전체 앱 Mongo scope 및 배포 selector: 다음 단위
- 실제 A/B 백업·각 복원·키 복구·실데이터 복사·최종 전환: 외부 운영 단계
