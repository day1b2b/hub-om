# 관리자 백업 범위

기준 f0b3e479d140a81e78f2a73ddf7c74063fd8e14f, feature/20260930-mongodb-admin-backup. 기존 API POST /api/admin/backup의11개 전체model조회+최근20개보관metadata를 기본PG/명시Mongo repository로 분리한다. 원래 secret 또는 assertCoachPiiAccess, withActivity, 파일명/headers/counts/exportedAt/data shape와 복호화된 승인응답을 보존한다. 저장데이터·오류/로그에 평문PII를 추가하지 않는다.

기존 CoachdbArchiveSnapshot은35model계약에 포함되어 새schema가 필요없다. 실제 복구용 전체DB백업이나 암호화된파일제품을 새로 만드는 범위가 아니다. 기존 endpoint 자체도 전체35model 또는 CoachdbArchiveRow 원문을 내보내지 않는다. 새 삭제정책/의존성/필드/권한/생산selector 없음. 원천/운영키/실DB/원본workspace/main/dev는 변경하지 않는다.

R1/R2/R4/R5/R6 적용5/6 Level3. 이전 하네스/validated-plan 지속. 사용자 개발·검증·총괄통합 승인유효, 실제미결정없음. fresh root /private/tmp/hub-om-admin-backup-20260930, PG56756, Mongo27856 예정이며 점유/소유확인 후 사용한다. 이전health는 자원정리완료·원격통합 f0b3e47이므로 반복하지 않는다.
