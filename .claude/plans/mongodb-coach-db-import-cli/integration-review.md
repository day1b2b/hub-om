# 코치 DB 가져오기 CLI 통합 검토

총괄 `feature/20260922-mongodb-parallel-transition`의 `42cbdcc032c230f7ab9f0ebbaeb2e51b4f57d320`에서 시작했다. 제품·검증 SHA는 `39a83a906570affd5aba7b286a7c97e41a08e776`, 최초 문서 포함 SHA는 `de602840ef9e6199d5305aa2aa8c113db96b4e31`이다. 일반 1,138 pass/126 skip, 실제 source PG·target PG·Mongo, UTC·서울·미국 서부 시간대, typecheck/build/lint를 통과했고 독립 최종 리뷰에서 잔여 P0–P3가 없었다. 작업 브랜치를 push한 뒤 총괄 브랜치에 fast-forward했고, 두 원격 브랜치를 이 최종 기록 커밋과 동일한 HEAD로 대조한다.

이 통합은 코치 DB 가져오기 CLI의 저장 경계만 뜻한다. 실제 운영 import, 독립 A/B 백업과 각 복원, production selector, 실데이터 복사·최종 전환과 `dev → main` 조건은 미완료다.
