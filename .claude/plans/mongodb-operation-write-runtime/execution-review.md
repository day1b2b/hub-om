# Mongo 운영 쓰기 runtime 실행 리뷰

## 구현

- 기존 Calendar runtime을 `reflectOperations: true`로 여는 명시 operation write runtime을 추가했다.
- 빈 namespace만 준비하고 완성·부분 namespace는 무수정 readiness 검사로 처리한다.
- 실제 운영 생성→회차 추가→순서 변경→삭제 API를 같은 scope에서 실행했다.
- Mongo 업무 저장·soft-delete, Calendar 이벤트·mapping, 요청 감사와 PG/외부 tripwire를 검사했다.
- 계약 밖 legacy collection만 있는 namespace도 비어 있지 않은 것으로 판정해 무수정 실패시킨다.
- 순서 변경 로그에서 사용자 이메일·원문 오류를 제거하고 요청 ID·변경 건수만 남긴다.
- Calendar 생성·삭제 실패 뒤의 업무 저장·감사·mapping 상태와 후속 요청 의미를 실제 handler로 고정했다.
- 감사 필드와 암호화 raw BSON, 감사 저장 실패의 best-effort 응답을 확인했다.

## 검증

- 실제 MongoDB 8.0.30 + 합성 Calendar remote: 1 pass / 0 skip / 0 fail
- 전체 일반 테스트(이번 실제 Mongo opt-in 포함): 1,164 pass / 134 skip / 0 fail
- typecheck/build: 통과
- 전체 lint: 오류 0 / 기존 경고 7
- 독립 리뷰: P1 3건 / P2 3건을 수정한 뒤 최종 P0/P1/P2/P3 0건
- 합성 Mongo 프로세스·dbpath·바이너리·로그 정리 완료

## 한계

- 실제 Google·운영 데이터·운영 namespace·배포 설정에는 접근하지 않았다.
- 이번 runtime은 네 운영 쓰기 API만 대상으로 한다.
- Calendar 삭제 실패 뒤 soft-delete와 mapping이 남으면 동일 DELETE가 업무 행을 다시 쓰지 않고 Calendar 정리만 재시도한다.
- production selector와 운영 이전은 미완료다.
