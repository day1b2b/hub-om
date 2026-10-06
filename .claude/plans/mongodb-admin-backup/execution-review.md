# 관리자 백업 실행 결과

관리자 backup POST를 기본PG/명시adminBackup repository로 분리했다. 기존 secret 또는 실제 PII admin guard, withActivity, 파일명·headers·exportedAt/counts/data와11개모델전체행·보관metadata6필드최근20개를 유지한다. 승인 응답의 복호화 개인정보와 저장상태 암호화를 구분하며 Mongo companion은최상위에서만제거해사용자JSON키를보존한다. Mongo단일snapshot·누적2만행/32MiB/60초는명시검증범위의보호한계이며초과시전체reject한다. PG에새한도는없다. 저장소실패는cause없는ADMIN_BACKUP_READ_FAILED이며인증오류/withActivity500감사는기존제어흐름을유지한다.

일반1061PASS/97 opt-in skip/0FAIL, scope16PASS(일반의부분집합), 실제Mongo15PASS/0skip(root+14), 실제PG frozen original/current ×UTC/Asia-Seoul 각11사례=44관찰/root1PASS/0skip. typecheck-final/build-final PASS, lint-final 오류0/기존경고7. 중복합산하지않는다. 전체과거Mongo묶음을새로돌린것은아니며변경없는privacy/auth/activity/codec/schema/package/loader15파일hash로기존검증을재사용한다. 일반검사후변경은PG opt-in runner경고허용목록과digest2파일뿐이며actualPG·최종type/lint로재검증했다.

## 실패 및 보완

초기build는부모mappedtype이readonly를상속해TS2540; -readonly 타입만보완하고최종build통과. sharedfixture빈배열타입TS2352도명시Row[]로수정했다. native첫실행12PASS/3FAIL은정렬Map비교·failpoint가관찰조회에적용된2개하위실패와root중복이다. ordered entries·주입전raw관찰·실제POST/서버진입검증으로보완했다. 독립리뷰추가5항목(timeoutMS7000/5000전달,정확timeout오류,close완료/5초,실패직전raw불변,30초소유정리)을닫고native-fixed15PASS. PG초기/diagnostic은workerexit0이어도미승인Node경고로실패처리했다. 정확한소유파일경로·고정경고만허용하고미지/민감stderr음성대조를유지해pg-fixed통과. 실패로그를삭제하지않았다.

## 증거·정리

독립 native-code-review/native-review-final/pg-route-code-review/scope-code-review/pg-review-final 참조. 영속근거 /Users/ga/.cache/hub-om-verification/20260930-admin-backup: source-final1029파일·sha25631증거·product-final6파일. PG35표row0/다른client0, Mongo systemDB만/backup작업0/failpointoff 확인후 소유PID9806/9820·port56756/27856·dbpath pg/mongo정리,빌린binary보존.

이 API는기존코치JSON다운로드이며전체35모델/원천archive row/복구이미지를제공하지않는다. 실제Next서버오류페이지·운영데이터·실원천·운영collation·실제A/B백업/각복원/복사/최종전환은미검증이다. Mongo snapshot은원본PG Promise.all에없던일관성보완이며원본과같은동시결과로주장하지않는다. driver read15초+제한된cleanup 검증을HTTP응답전체15초보장으로해석하지않는다. 기본PG·실백업증거0·dev→main조건미충족·자동화PAUSED를유지한다. 전체앱/활성CLI/예약/배포구성·snapshot개인정보분류·운영collation/TZ·운영이전은별도잔여범위다.
