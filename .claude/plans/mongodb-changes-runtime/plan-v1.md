# Mongo 변경 내역 runtime 계획 v1

## 목표

`/changes`가 사용하는 활동 조회·콘텐츠 피드·코치 메모·투입 평가와 요청 감사를 한 명시 Mongo runtime으로 조립하고, 실제 handler의 조회·쓰기·감사가 같은 namespace에 귀속되는지 검증한다.

## 대안과 선택

1. production selector를 먼저 만들면 전체 연결은 빨라 보이지만, 아직 미완료인 포트가 조용히 PostgreSQL로 fallback할 위험이 있다.
2. 완료된 개별 runtime의 repository 객체를 떼어 합치면 등록 scope의 완전성 보장을 깨뜨린다.
3. 같은 client/database/namespace에서 네 repository를 새로 열고 하나의 등록·잠금 scope로 조립한다.

3번을 선택한다. 생산 selector와 배포 설정은 변경하지 않는다.

## 안전 계약

- 새 빈 shadow namespace만 준비
- 기존·부분·준비 중단 namespace는 mutation 없는 전체 readiness 확인만 허용
- 포트 누락·다른 runtime 객체 혼합·nested scope 교체를 callback 전에 차단
- 기존 업무 감사와 요청 감사 정책 유지
- borrowed client와 합성 DB 소유권 유지
- 운영 데이터·외부 원천·키·환경·배포 불변
