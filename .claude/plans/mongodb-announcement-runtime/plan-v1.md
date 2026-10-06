# Mongo 공지·첨부 runtime 계획 v1

## 목표

완료된 공지·첨부 repository와 요청 감사를 한 명시 Mongo runtime으로 조립하고, 실제 handler와 페이지에서 업무쓰기·첨부·감사 계약이 함께 유지되는지 검증한다.

## 선택

1. production 환경변수로 공지 factory를 직접 전환하면 구현은 작지만 scope 누락과 조용한 PG fallback을 배포 전에 검증하기 어렵다.
2. 기존 내부 운영 runtime의 request audit 객체만 떼어 쓰면 등록된 완전 scope 계약을 깨뜨린다.
3. 같은 client/database/namespace에서 공지와 새 audit repository를 열어 완전한 두 포트 runtime으로 등록한다.

3번을 선택한다. production selector는 추가하지 않는다.

## 안전 계약

- 새 빈 shadow namespace만 준비
- 기존·부분 namespace는 read-only open readiness만 수행
- 공지 업무 감사와 요청 감사의 서로 다른 원자성 계약 유지
- 등록 runtime 객체 분해와 nested scope 교체 차단
- borrowed client와 합성 DB 소유권 유지
- 운영 데이터·외부 원천·설정 불변
