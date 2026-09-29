# 합성 환경
2026-09-29 실제확인 Node24.19.0, PG17.9, Mongo8.0.30.
소유root /private/tmp/hub-om-om-requests-20260929 (새dbpath). PG127.0.0.1:56709/om_requests_parity role synthetic. Mongo127.0.0.1:27809 replica omrequests20260929. 외부/운영접속없음.
실행 env -i HOME=/Users/ga PATH=/usr/bin:/bin /bin/bash <root>/run.sh setup 완료(exit0). 키는테스트프로세스내 randomBytes 생성하며코드·문서·로그에값미기록. migrations는새PG만적용예정.
전체static와Mongo묶음은최종제품코드준비후1회;추가수정은영향검증만. 루프백allowlist/DB역할·이름/replica확인후만합성drop/truncate허용. 종료시소유DB수·정상shutdown·정확dbpath정리확인. 준비는검증PASS아님.
