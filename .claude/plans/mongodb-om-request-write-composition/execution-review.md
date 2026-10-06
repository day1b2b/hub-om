# OM 요청 쓰기 composition 실행 검토

- 범위: 생성·수정·삭제와 배정 preview/PATCH API
- 기본 PostgreSQL, 정확한 `mongodb-shadow`만 준비된 runtime open
- Calendar-aware 저장소·네 effect port·요청 감사를 같은 잠금 scope에서 사용
- effect 실패 후 기존 best-effort 의미, 부분 namespace 무수정, 오류 비노출 유지
- 실제 외부 원천·운영 데이터·배포·최종 전환 제외
