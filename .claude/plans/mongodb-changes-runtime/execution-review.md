# Mongo 변경 내역 runtime 실행 리뷰

## 구현 결과

- 활동 조회·코치 콘텐츠·코치 투입 평가·요청 감사를 같은 borrowed Mongo client/database/namespace의 등록·잠금 scope로 조립했다.
- 새 빈 namespace만 audit→engagement→content→activity-read 순서로 준비하고 기존·부분 namespace는 mutation 없이 전체 readiness만 확인한다.
- 등록 runtime의 포트 누락·다른 runtime 포트 혼합·nested scope 전환을 callback 전에 차단한다.
- 실제 네 API handler에서 조회·수정·업무 감사·요청 감사와 암호화 저장을 검증했다.

## 실패와 보완

첫 실제 실행에서 합성 engagement의 날짜가 실행 시각에 따라 잘못 직렬화될 수 있어 고정 UTC 날짜로 바꿨다. 제품 동작 실패가 아니며 이후 실제 Mongo 검증은 통과했다.

독립 리뷰의 mutation 감시, 등록 객체 분해, handler 결과·감사 연결 증거 지적을 모두 보완했다. 재검토에서 P0/P1/P2 잔여 없음으로 수락받았다.

## 검증

- 일반 회귀: 1,090 pass / 103 opt-in skip / 0 fail
- 실제 MongoDB 8.0.30: 1 pass / 0 skip / 0 fail
- typecheck/build: pass
- lint: 오류 0 / 기존 경고 7

일반 회귀의 opt-in skip과 실제 Mongo 1건은 합산하지 않는다. 소유한 합성 replica set·DB·port는 종료 후 정리했다.

## 현재 한계

`/changes` 페이지 자체는 서버에서 데이터를 읽지 않고 브라우저가 네 API를 호출한다. 실제 handler 경계는 검증했지만 브라우저 렌더링·상호작용과 생산 selector는 검증하지 않았다. 운영 DB·Atlas·실제 외부 원천·운영 키·배포 설정에는 접근하거나 쓰지 않았다.
