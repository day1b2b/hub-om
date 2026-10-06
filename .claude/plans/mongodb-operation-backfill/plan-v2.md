# 운영 보정 실행 계획 v2

plan-v1 Core1–3 역할/범위를 유지하고 validation-v2를 수락기준으로 삼는다.

명확화: context없음은 PG기본, 명시scope서비스누락/실패만fallback금지. OM목표ASSIGNMENT_PLANNED. 100개초과대상중후행실제쓰기/감사실패로전체원복검증하며페이지단위쓰기구현을강제하지않는다. 같은backfill중복실행도실제경합과재시도후0/감사중복없음을검증한다. 원본API의실행버튼/권한/조건을유지, 기존별도onsite보정CLI는legacyPG전용으로남기고이번API전환완료와구분한다.
