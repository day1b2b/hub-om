**CLI 6개 사례의 독립 검토를 수락합니다. 추가 결함은 발견하지 않았습니다.**

- 실제 CLI entry를 실행해 `.env → .env.local → argv` 우선순위와 `finish → close → 최종 JSON` 순서를 확인합니다.
- missing-key 사례는 실제 기본 PG 저장소·privacy guard를 유지하며, DB/source 호출 전 차단과 고정 오류·exit1을 검사합니다.
- blocked-worker 사례는 실제 프로세스 종료를 관찰하며, service의 잔여 worker 완료나 DB 저장 증거로 확대하지 않습니다.
- [cli-fixed.log](/private/tmp/hub-om-drive-writer-20260930/logs/cli-fixed.log)의 **6 PASS / 0 fail / 0 skip**을 확인했습니다.

합성 port 기반 CLI 경계 수락입니다. 실제 PG/native 저장·scanner 및 작성 중인 A/B·parity 수락과는 별개이며, DB·테스트 실행·파일 변경은 하지 않았습니다.
