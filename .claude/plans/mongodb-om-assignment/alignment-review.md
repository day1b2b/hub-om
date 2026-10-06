# 요청·계획·구현 정합성 검토

## 범위
작은 수직 단위인 OM 전체 배정만 구현한다. 접수 단위의 완료 작업을 다시 구현하지 않는다. 기존 PostgreSQL 기본 선택과 실제 운영 데이터를 유지한다.

|요구|대응|
|--|--|
|원본 동작/서명 보존|byte-frozen original과 PG/newPG/Mongo 대조. batch 자체 서명이나 새 명단 제한을 추가하지 않음|
|정확한 대상/중복 방지|하나의 요청 생성 배치·기대 회차 수·대표 포함·비삭제·중복 없음. 같은 과정 회차로 대상 확장하지 않음|
|암호화와 승인된 응답 구분|저장은 기존 codec과 HMAC, 응답은 기존 권한을 통과한 복호화 DTO. 로그에 raw 예외를 넣지 않음|
|원자성/재실행|필요한 회차/요청/변경감사 한 tx, 실패 전체 원복. 완전 noop 업무 raw 불변, 내부 guard nonce만 허용|
|동시 실행|기존 과정명 복원 guard 공유. 무조건 변경행만 쓰는 대안은 역의존 cycle로 기각. 다른 writer에 근거 없는 신규 잠금 추가 없음|
|오류/외부 부수 작업|명시 port 누락은 쓰기 전에 실패. 커밋 뒤 변경 회차만 Calendar, 기존 Slack 조건. commit 불명을 rollback으로 단정하지 않음|
|운영 제한|실 원천·운영 DB·키/env·배포·main/dev·원본 workspace·자동화 무변경|
|검증/인계|실제 PG45migration+oracle, native replica/writers/handler, 일반/type/lint/build, 독립 검토. 최종 수락·정리·원격 상태는 execution/integration review|

## 남는 한계
브라우저 E2E/실 로그인/실 Calendar·Slack/운영 처리량 및 network failure는 미검증이다. Unknown commit/11000 일부 분기는 fault injection이며 native112 관측과 구분한다. 요청에 updatedAt이 없어 모든 변경 이력을 서명으로 추적하지 않는 기존 한계, 권한 사전조회와 트랜잭션 분리, namespace 전역 guard 경쟁을 보존한다.

전체 runtime·브라우저 초안·생산 연결·실제 데이터 복사/복원 리허설·최종 전환과 dev→main 조건은 아직 미완료다. 최종 실행 증거 수락 전에는 이번 기능도 완료로 표시하지 않는다.
