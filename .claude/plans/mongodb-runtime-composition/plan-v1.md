# Mongo runtime 조립 계획 v1

## 이번 첫 단위

운영 backend selector를 켜기 전에 PostgreSQL의 실제 문자열 정렬과 앱 세션 시간대가 현재 Mongo parity 가정과 맞는지 판정할 읽기 전용 preflight를 만든다.

## 대안 검토

1. 전체 앱을 즉시 Mongo scope로 감싼다. 개별 저장소는 shadow write gate와 명시 namespace를 요구하고 운영 namespace·배포 조립 결정도 열려 있어, 지금 적용하면 안전 장치를 우회하거나 일부 endpoint를 부분 구성할 위험이 있다.
2. 전체 Mongo scope builder만 먼저 만든다. 운영 전제를 판정하지 않은 채 큰 조립 코드를 만들면 검증 fixture와 실제 배포의 차이가 남는다.
3. PostgreSQL runtime 전제 preflight를 먼저 만든다. 데이터 변경 없이 다음 조립의 차단 조건을 실제 환경에서 판정할 수 있다.

3번을 선택한다. 결과는 기능 전환 완료가 아니라 다음 단계의 입력 게이트다.

## 완료 기준

- 연결 시작부터 read-only이고 업무 테이블을 조회하지 않는다.
- 앱과 같은 UTC 세션, UTF8, UTF-8 byte 정렬, collation version을 분리해 판정한다.
- 연결 정보·DB 이름·드라이버 오류·합성 probe를 출력하지 않는다.
- 불일치는 명시적으로 blocked이며 성공 종료하지 않는다.
- 합성 PostgreSQL에서 실제 명령을 검증하고 소유 자원을 정리한다.
