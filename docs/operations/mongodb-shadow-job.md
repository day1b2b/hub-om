# 운영 앱과 분리된 MongoDB 복사 job

운영 PostgreSQL을 유지하며 준비된 export/import 도구만 실행하는 별도 이미지다. 운영 앱의 Dockerfile, entrypoint, factory는 변경하지 않는다. 앱 포트·스케줄러·migration·자동 전환이 없다. **이미지/명령 준비는 실제 복사 완료가 아니다.**

## 실행 계약

- `Dockerfile.mongodb-shadow`는 source/scripts/schema와 lockfile 의존성만 포함한다. 전용 `.dockerignore`로 `.env`, Git, 개인 파일, 로컬 산출물을 build context에서 제외한다. build 시 사용하는 PG URL은 합성 문자열이며 DB에 연결하지 않는다.
- job은 명시적 `export` 또는 `import` 인자와 확인 flag가 없으면 실패한다. `RUN_DB_MIGRATIONS=true`도 거부한다. child는 shell 없이 고정된 script만 실행하고 환경변수는 allowlist로 재구성한다.
- export child는 PostgreSQL 연결과 개인정보 키만 받는다. 서버 기본 read-only 설정에 더해 기존 export의 단일 READ ONLY REPEATABLE READ transaction을 사용한다. Mongo 접속 정보는 전달하지 않는다.
- import child는 Mongo 연결과 개인정보 키만 받는다. PostgreSQL 접속 정보는 전달하지 않는다. 대상은 정확한 `hub-om-shadow-validation`이며 보호할 `MONGODB_PRODUCTION_DATABASE`와 같으면 실패한다.
- `/spool`에 생성되는 `mongo-shadow-UUID` 디렉터리는 암호화된 파일과 manifest만 가진다. import는 같은 디렉터리와 run ID로 재시도한다. 새 export는 새 디렉터리/run ID를 사용한다. 키 회전은 이 과정에 섞지 않는다.
- 부모 컨테이너에도 해당 단계에 필요한 비밀값만 주입한다. `NODE_OPTIONS`, 임의 entrypoint, 운영 앱의 전체 환경을 복제하지 않는다. build arg나 명령줄에 비밀값을 넣지 않는다.

## 실행 형식

실제 서버에서 검토한 커밋을 고정하여 이미지를 빌드한다. 아래 이름은 실행 예시이고 실행 기록이 아니다. 이 작업을 위해 운영 앱을 재배포하지 않는다.

```sh
docker build -f Dockerfile.mongodb-shadow -t hub-om-shadow:REVIEWED_COMMIT .
```

호스트의 승인된 비밀 저장소에서 단계별 0600 환경 파일을 준비한다. export: DATABASE_URL와 PII 3개; import: MONGODB_URI, MONGODB_SHADOW_DATABASE, MONGODB_PRODUCTION_DATABASE, MONGODB_ALLOW_SHADOW_WRITES=true, 동일 PII 3개. Coolify에 저장만 된 값과 실행 중인 컨테이너 환경은 구분한다. 이미 운영 중인 앱에 값이 없다는 이유로 신규 암호화 코드를 먼저 배포하면 안 된다.

전용 spool 경로는 job의 uid 1000만 접근할 수 있게 준비한다. 명령의 경로·network·image는 실제 서버에서 확인한 값을 사용한다. 운영 폴더 전체나 Docker socket을 job에 mount하지 않는다.

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 512m --cpus 1 --pids-limit 128 --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --network VERIFIED_DB_NETWORK --env-file /secure/shadow-export.env \
  --mount type=bind,src=/secure/shadow-spool,dst=/spool \
  hub-om-shadow:REVIEWED_COMMIT export plaintext --allow-read-only-source-export

docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 512m --cpus 1 --pids-limit 128 --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --network VERIFIED_DB_NETWORK --env-file /secure/shadow-import.env \
  --mount type=bind,src=/secure/shadow-spool,dst=/spool,readonly \
  hub-om-shadow:REVIEWED_COMMIT import /spool/mongo-shadow-RETURNED_UUID rehearsal_01 --apply-shadow-only
```

## 검증·실행 경계

allowlist, 확인 flag, migration 거부, directory 제한, source/destination 자격정보 분리, 실제 exporter의 디렉터리 명명 규칙을 자동 검사한다. Docker 이미지 build와 두 엔진을 통한 전체 실행은 별도 검증이며 해당 결과 없이 실행 준비 완료라고 하지 않는다.

실제 복사 전에는 현재 백업 및 키 복구 가능 여부, source schema와 읽기 권한, 대상 권한/용량, namespace 독점, 고정 이미지 내용을 확인한다. 최초 snapshot 이후 PG 변경은 자동 반영되지 않는다. 전체 앱 runtime·업무 대조·최종 동기화·복구 리허설이 남아 있으므로 복사 성공 결과도 cutover를 승인하지 않는다.

원천 모드는 배포·변환 이력 또는 값을 출력하지 않는 검사로 확인한다. `plaintext` 모드는 암호문 모양의 원문도 암호화하므로, 이미 암호화된 데이터가 섞여 있으면 일부 JSON을 이중 암호화할 수 있다. 모드를 추측하여 운영 export를 실행하지 않는다. URI 옵션이 환경의 timeout을 덮어쓸 수 있으므로 실행 시간 제한은 작업 실행기에도 설정한다. 별도 read-only transaction은 환경의 기본값과 무관하게 유지된다.
