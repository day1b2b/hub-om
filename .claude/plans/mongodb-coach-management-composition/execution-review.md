# 코치 관리 API composition 실행 리뷰

- 기준 총괄: `291d26345318e0279da6c05af67b36aad30abd92`
- 제품 SHA: `ee2cd7377b1f2334c13e536b7f55bdbf0197e829`
- 검증: composition 단위 6, 실제 Mongo 집중 묶음 8, 전체 1,336 pass / 169 skip / 0 fail
- typecheck/build 통과, lint 오류 0 / 기존 경고 7
- 독립 리뷰: P0 0 / P1 0 / P2 0 / P3 0

초기 독립 리뷰의 P1은 composition이 Next redirect/notFound를 고정 오류로 바꾸던 문제였다. 해당 제어 흐름 객체를 그대로 다시 던지고 단위·실제 route 검증을 추가했다. P2는 mock request audit만으로 실제 조립을 충분히 증명하지 못한 문제였으며, 실제 `withActivity`와 exact selector로 여섯 CRUD handler를 실행해 같은 namespace의 감사 6건과 인증 redirect 감사 1건을 확인했다.

실제 Mongo 검증 중 처음에는 테스트 database 이름 제한을 넘겨 명시 shadow database 검사가 실패했고, 합성 이름을 줄여 해결했다. 이어 감사 순서를 삽입 순서로 가정한 검증이 실패해 순서와 무관한 정확한 집합 비교로 수정했다. 제품 동작 실패는 아니었다.

운영 데이터·원천·키·환경변수·배포 설정에는 접근하거나 변경하지 않았다. 실제 운영 복사·복원·전환은 검증하지 않았다.
