# 기존 저장소 검증 재사용 근거

Carver read-only 검토: staging 보존 증거33개 hash 일치, source manifest17중13개 일치. 변경4개는 context·staginghandler test·OMtest2개. 기준c11a05c→8b4d954에서 Mongo import/store/codec/crypto/privacy/contracts/명단 repository/package/lock/schema/loader 동일.

하위 sourceType/HMAC인증·키/companion/cipher손상·scan20k/32MiB·readiness·부모·중복/rollback은 불변 의존 증거로재사용. 새 실제 Sheets handler/source/auth/감사/wholeDTO/preflight/격리/retry횟수 증거를 대신하지 않음. context변경은 현재 회귀실행 필요. 60초는store진입부터이며 HTTP전체기한 아님.

원본근거: ../mongodb-import-staging/source-digests.json 및 /Users/ga/.cache/hub-om-verification/20260930-import-staging/sha256.json. 코드추가변경 시 해당재사용판정 재검토.
