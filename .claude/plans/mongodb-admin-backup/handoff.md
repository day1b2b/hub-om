# 관리자 백업 인계

현재feature/20260930-mongodb-admin-backup, 구현·검증·독립리뷰·소유자원정리완료. 제품e7e1c98원격통합완료, 후속기록은integration-review를따른다. Level3필수산출물완비, 다음resume action start_next_task(통합확인후).

관리자 backup POST를 기본PG/명시adminBackup repository로 분리했다. 기존 secret 또는 실제 PII admin guard, withActivity, 파일명·headers·exportedAt/counts/data와11개모델전체행·보관metadata6필드최근20개를 유지한다. 승인 응답의 복호화 개인정보와 저장상태 암호화를 구분하며 Mongo companion은최상위에서만제거해사용자JSON키를보존한다. Mongo단일snapshot·누적2만행/32MiB/60초는명시검증범위의보호한계이며초과시전체reject한다. PG에새한도는없다. 저장소실패는cause없는ADMIN_BACKUP_READ_FAILED이며인증오류/withActivity500감사는기존제어흐름을유지한다.

일반1061PASS/97 opt-in skip/0FAIL, scope16PASS(일반의부분집합), 실제Mongo15PASS/0skip(root+14), 실제PG frozen original/current ×UTC/Asia-Seoul 각11사례=44관찰/root1PASS/0skip. typecheck-final/build-final PASS, lint-final 오류0/기존경고7. 중복합산하지않는다. 전체과거Mongo묶음을새로돌린것은아니며변경없는privacy/auth/activity/codec/schema/package/loader15파일hash로기존검증을재사용한다. 일반검사후변경은PG opt-in runner경고허용목록과digest2파일뿐이며actualPG·최종type/lint로재검증했다.

Do Next: 별도작업branch에서activity:prune CLI 저장소전환. 기존PG transaction과동일한2표삭제원자성/보존기간/배치/종료를검증한다. Do Not: 완료백업검사반복·운영데이터정리·실환경접근·자동화재개·main/dev/원본workspace변경.

이 API는기존코치JSON다운로드이며전체35모델/원천archive row/복구이미지를제공하지않는다. 실제Next서버오류페이지·운영데이터·실원천·운영collation·실제A/B백업/각복원/복사/최종전환은미검증이다. Mongo snapshot은원본PG Promise.all에없던일관성보완이며원본과같은동시결과로주장하지않는다. driver read15초+제한된cleanup 검증을HTTP응답전체15초보장으로해석하지않는다. 기본PG·실백업증거0·dev→main조건미충족·자동화PAUSED를유지한다. 전체앱/활성CLI/예약/배포구성·snapshot개인정보분류·운영collation/TZ·운영이전은별도잔여범위다.
