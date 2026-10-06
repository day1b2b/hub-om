# PostgreSQL → 암호화 검증 사본 재현 검사

운영 PostgreSQL을 사용하지 않는 합성 데이터 전용 검사다. 스크립트가 새 임시 PostgreSQL 클러스터를 만들고 비어 있는 로컬 포트에만 연결한다. 기존 서버를 재사용하지 않으며 `DATABASE_URL` 및 `.env` 파일을 읽지 않는다. 암호화 키는 실행 중 생성한 합성 값이며 디스크에 보관하지 않는다.

```sh
# 저장소 루트에서 실행. PostgreSQL 18 바이너리가 필요하다.
# macOS 기본 위치가 다르면 PG_BIN에 PostgreSQL bin 디렉터리를 지정한다.
node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs \
  scripts/check-postgres-shadow-synthetic.ts --allow-disposable-local-postgres
```

검사 내용:

- 별도 DB 두 개에 체크인된 migration을 순서대로 적용한다. 하나는 PII migration 두 개를 제외한 이전 스키마, 다른 하나는 전체 스키마다.
- 합성 기업·과정·회차·코치·개인 프로필·가져오기 이력을 넣는다. SQL NULL과 JSON null, 교육일 배열, 금액을 포함한다.
- 한 DB는 평문 원천에서 한 번 암호화해 내보내고, 다른 DB는 합성 개인정보 변환 후 기존 암호문을 내보낸다.
- 두 DB 모두 실제 PostgreSQL reader → 35개 모델 spool → 해시 대조 → 메모리 target 복사 → 참조·고유키 검사 → 중복 재시도를 수행한다.
- 개인정보 복호화 값, JSON null 구분, 교육일 배열, 파일 내 개인정보 평문 미노출을 검증한다.
- 실제 export CLI를 자식 프로세스로 실행하고 그 결과도 다시 읽어 검증한다.

2026-09-22 검증 결과: 이전 스키마 42개·전체 스키마 44개 migration 적용, 각각 **35개 모델·7개 합성 행 통과**. 첫 실DB 검사에서 발견한 카탈로그 배열의 드라이버 파싱, enum `@map`, SmallInt 대응 문제를 수정한 뒤 재실행해 통과했다.

정상·실패 종료 시 스크립트가 자신이 시작한 클러스터를 중지한다. 강제 종료나 시스템 장애로 정리되지 않으면 출력한 임시 디렉터리의 `data`에 대해서만 `pg_ctl -D <임시디렉터리>/data stop -m fast`를 실행한다. 생성 폴더에는 합성 DB와 암호문 검증 파일만 남는다. 이 검사는 실제 MongoDB 저장이나 운영 데이터 이전, 운영 전환을 검증한 것으로 간주하지 않는다.
