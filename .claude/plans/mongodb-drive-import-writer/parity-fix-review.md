**기존 parity P2 3건은 정적 재검토상 해소됐습니다.**

- 이전 이력: raw·decoded 전체 tuple을 보존하고 각 실행 및 최종 recovery 후 재대조합니다. 동일 ID 내용 변조 음성대조도 있습니다.
- 출력: current/native 로그와 stderr를 검증하며, 위반은 catch 밖에서 거부합니다. 원본 오류 출력 예외는 분리돼 있습니다.
- NULL: 정규화 전에 pending summary의 raw NULL과 PG `IS NULL`을 검사합니다.

추가 `source-stringification-error`도 pending 유지, append/finish 호출 0, source 1회와 progress를 검사하도록 연결돼 있습니다.

**실행 증거는 아직 전체 PASS가 아닙니다.** [parity-final.log](/private/tmp/hub-om-drive-writer-20260930/logs/parity-final.log)에서 확인한 범위는:

- legacy/UTC 22개 사례 완료
- cleanup `remaining:0`, worker `exit:0`
- 이후 부모 harness의 `UNAPPROVED_STDERR_LINE`으로 전체 검사 실패
- current/native 및 나머지 TZ는 이 로그에서 완료 증거 없음

거부된 stderr 원문은 로그에 없어 정확한 원인은 아직 단정할 수 없습니다.

[native-typefix-equivalence.json](/private/tmp/hub-om-drive-writer-20260930/native-typefix-equivalence.json)의 전후 runtime hash 일치와 현재 제품 파일의 `afterSourceSHA256` 일치를 확인했습니다. 직접 transpile·테스트·DB 실행이나 파일 수정은 하지 않았습니다.
