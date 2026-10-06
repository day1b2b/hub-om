# 공지·첨부 전환 요구사항

사용자 계속 진행 요청에 따라 관리자 DB 다음 단위인 공지·첨부를 구현·합성검증·독립리뷰·작업push/총괄통합한다. 기준 5f9d29114bc663578fbd4000495ef567ee3db8b1, 최신dev307f52f, clean 격리clone /Users/ga/workspace/hub-om-mongodb-coach-content. feature/20260929-mongodb-announcements. 원본workspace 미수정.

목표: 공지 list/detail/create/update/softDelete 및 첨부 다운로드/수정시제거·추가를 repository/context로 분리하고 명시Mongo검증을 지원한다. 페이지3개/기존6handler(목록GET/POST,상세GET/PUT/DELETE,첨부GET), 새작성page는권한/UI불변. 기본PG와기존동작보존, 전체앱/데이터이전과구분.

기존계약: 관리자만접근, HTMLsanitize/titletrim/빈내용거부,5파일각5MiB,작성자불변,삭제시공지soft-delete+첨부보존,수정시부모에속한선택첨부만물리제거. 신규삭제정책추가금지. PUT기존preflight가removeAttachmentIds 원소수를빼는 계산(중복/외부ID포함)이고쓰기전active재검사를하지않는다. 이번작업은기존PG/동일serial및동시계약을보존하고첨부상한버그수정이나새낙관적충돌정책을혼입하지않는다. 정확한허용·오류는실PG로대조.

운영/Atlas/실NotionGoogle/개인정보/실키/env/배포변경금지,새의존성/업무schema금지,main/dev작업·병합금지(전체완료조건미충족),자동화PAUSED. 새임시키·loopback·소유합성PG/Mongo만사용. 이전검사재실행은새변경회귀에필요한범위만.

R1범위/R2복합원자성/R3Bytes암호화크기·감사실PG불확실/R4권한·파일반환/R5실사용계약/R6연속인계 모두해당=6, Level3. 대안: 페이지/route별Mongo직접분기는권한/DTO중복으로제외; 좁은repository+기존파서/formatter유지선택. 첨부를하나의부모문서에embedding하면5x5MiB가Mongo16MiB한도를넘어기존분리모델유지. 미결정업무정책없음.
