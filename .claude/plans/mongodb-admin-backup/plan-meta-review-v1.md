**설계 방향은 수락 가능합니다. 35모델 export로 확대할 이유는 없습니다.** 다만 최종 메타 수락 전 문서·validation에 다음 두 항목을 명확히 고정해야 합니다.

- **archive 6필드:** 전체 codec 인증을 하지 않으며, 반환하지 않는 `error_message` 암호문/HMAC 손상은 성공 여부에 영향을 주지 않는다고 명시하고 검증해야 합니다. 현재 projection 설명만으로는 이 실패 경계가 불명확합니다.
- **단일 snapshot:** 원본 PG `Promise.all`에는 없는 의도적 일관성 강화임을 명시해야 합니다. 정적 fixture는 전체 동등 비교하되, 동시 변경 사례에서 PG와 동일 시점 결과를 요구하면 안 됩니다.

공개 scalar 보존·Mongo companion 제거, PG 무제한 유지/Mongo 누적 20k 초과 전체 실패, 기존 secret/session/activity 보존은 적절합니다. JSON null·날짜를 포함한 **전체 공개 필드 집합**은 독립 literal로 확인해야 합니다.

현재 validation은 아직 없어 최종 검증 설계 판정은 보류합니다. 파일 변경·DB·테스트 실행은 하지 않았습니다.
