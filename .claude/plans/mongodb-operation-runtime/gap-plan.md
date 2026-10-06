# Gap 보완 기록

독립 reviewer 두 명(sql_review, mongo_docs)의 지적을 반영했다.

1. 원천 이력 전체 읽기 → 서버 group별 latest 전체 문서 선택. 20,001 과거 이력 실제 검증 통과.
2. N+1 → 목록 5회 일괄 조회. reviewer 합성 100건에서 401→5회 저장소 호출 재현. 실제 운영 규모 SLO는 별도.
3. 감사 테스트 문맥/UUID 누락 → suite context 및 UUID, 회차 감사 단계 실패 주입. 오류 유형과 회사/과정/회차/claim/counter 전부 rollback 검증.
4. JSON PII 느슨한 validator → exact wrapper/full envelope/null-HMAC 동반 조건. 평문·가짜 envelope·누락 index raw write 오류121 검증.
5. 같은 회사의 무관 label 과조회 → 표시 과정의 정확한 회사/코스ID 쌍 필터. 무관 label20,001개 실제 검증 통과.
6. 검증 공백 → 32MiB·동시 다른 fingerprint·동시 다른 필드수정·동일 PII audit 생략·redaction·복합 과정변경·HMAC equality 회귀 보강.

현재 구현 범위 미해결 로컬 gap 없음. 외부 MongoDB 권한/TLS/배포, 다중노드 장애/unknown-commit, 생산 규모 성능·백업/역이전·전체 repository 전환은 이번 로컬 구현 수락 밖의 전환 gate로 남긴다. 이를 통과한 것으로 계산하지 않는다.
