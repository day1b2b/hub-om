# Mongo 활동 조회 runtime 실행 리뷰

## 구현 결과

- 완료된 `MongoActivityReadRepository`를 등록·잠금된 단일 포트 runtime으로 조립했다.
- 모든 runtime 모델과 알려진 내부 collection의 정확한 이름을 확인하는 공통 namespace 소유권 판정을 추가하고 기존 운영 runtime도 이를 재사용하게 했다.
- 새 빈 shadow만 준비하며 기존·부분 namespace는 쓰기 없이 전체 readiness로 실패하거나 열린다.
- read-only open에서 쓰기 capability를 제거하고 borrowed client lifecycle을 유지했다.
- 기존 실제 세 GET 통합 검증이 새 runtime을 통해 실행되도록 바꿨다.

## 리뷰 보완

독립 리뷰에서 실제 GET 구간의 mutation ledger와 합성 DB 정리 소유권 공백이 지적됐다. 일반 변경 명령과 aggregate `$out`/`$merge`를 감시하고 각 runtime GET의 성공·실패 구간마다 mutation 0을 단언했다. DB는 사전 부재를 확인해 소유권을 얻은 경우에만 삭제한다. 최종 재검토 결과 P0/P1/P2 차단 이슈는 없다.

## 검증

- 일반 회귀: 1,090 pass / 102 opt-in skip / 0 fail
- 실제 MongoDB 8.0.30: 11 pass / 0 skip / 0 fail
- typecheck/build: pass
- lint: 오류 0 / 기존 경고 7

실제 Mongo 검증은 활동 조회의 10개 세부·lifecycle 시나리오와 공통 helper를 쓰는 내부 운영 runtime 회귀 1건이다. 운영 DB·Atlas·실제 외부 원천·운영 키·배포 설정에는 접근하거나 쓰지 않았다.

## 남은 범위

이 수락은 세 활동 조회 GET의 명시 shadow 조립에 한정한다. `/changes`의 코치 콘텐츠 쓰기, 전체 요청 composition, production selector·활성 작업·배포, 실제 데이터 이전·백업·복원·최종 전환은 완료되지 않았다.
