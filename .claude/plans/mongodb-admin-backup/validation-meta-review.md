**plan-v2·validation-v2 최종 메타 수락입니다. 남은 설계 차단 사유는 없습니다.**

- archive 6필드만 검증하고 비선택 암호문 손상은 무시하는 기준이 명확합니다.
- Mongo snapshot·누적 한도를 PG와의 의도적 차이로 분리했습니다.
- 복합 PK를 포함한 전체 행 다중집합·음성대조로 누락·중복을 검출합니다.
- `ADMIN_BACKUP_READ_FAILED`의 cause 없는 reject, 기존 withActivity의 500 감사, 인증 제어 흐름 유지가 확정됐습니다.

validation 앞부분의 v1·조건부 표현은 편집 잔여지만, 하단 확정 기준과 plan-v2로 의미는 명확합니다. **계획 수락이며 구현·실행 수락은 아닙니다.**
