**독립 PG 실행 수락입니다. 이전 stderr gate 실패는 종결 가능합니다.**

- 허용 규칙은 정확한 소유 worker/package/loader 경로와 고정 Node 경고만 허용합니다. 미지 경고·민감 출력 거부 음성대조도 유지됐습니다.
- [pg-fixed.log](/private/tmp/hub-om-admin-backup-20260930/logs/pg-fixed.log): **root 1 PASS·0 fail·0 skip**, 원본/current × UTC/Seoul **4 worker 모두 exit0**, 총 **44사례** 확인.
- 각 worker에서 승인 6건·거절 5건, 승인 시 12모델 조회·거절 시 조회0, 감사 누적 1→11, raw 불변·위반0을 확인했습니다.
- 전체 응답 literal 검사를 통과했고, 양쪽 logical ledger도 TZ별 일치합니다.
- 네 worker 모두 cleanup·socket close 확인, stdout0·미승인 stderr0입니다. provenance와 동결 hash 불일치도 없습니다.

수락 범위는 **PG 원본/current backup 경계**입니다. native·전체 자원 철거는 별도 증거 대상이며, 직접 DB·테스트 실행이나 파일 변경은 하지 않았습니다.
