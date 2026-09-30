# Alignment Review: mongodb-coach-public-pages

## 요구사항 정합

- 생산 기본 PostgreSQL 유지: 충족. scope 밖 factory 동작을 바꾸지 않았다.
- 명시 Mongo context: 충족. `coach` 객체를 그대로 반환하고 누락 scope는 고정 오류다.
- 기존 사용자 흐름 유지: 충족. 7개 page를 수정하지 않고 실제 module 결과를 검증했다.
- 개인정보 비노출: 합성 범위 충족. 저장 평문·공개 DTO 비공개 필드·오류 원문 노출을 검사했다.
- 운영 데이터·원천·키·배포 불변: 충족.
- main/dev 직접 변경 금지: 충족.
- 백업 A/B: 후보만 확정. 실제 백업과 복원은 미충족이며 운영 gate로 유지한다.

## 범위 한계

이번 단위는 코치 공개 조회 factory와 해당 7개 page의 명시 조립만 다룬다. 전체 앱 composition root, 활성 CLI·예약 작업·배포 설정, snapshot 개인정보 분류, 실데이터 이전을 완료하지 않았다. 따라서 전체 Mongo 전환 또는 dev→main 병합 조건을 충족했다고 판단하지 않는다.
