# 실행 결과 매니페스트

기준 09e3b72. 원본 작업폴더의 미커밋 파일은 보존, 변경은 /tmp/hub-om-mongodb-20260922의 feature 브랜치에만 있다.

- Step 1/3: mongoTeamMemberRepository.ts, mongoCoachRepository.ts, mongoCoachPrivateRepository.ts, mongoCoachMapping.ts. 기존 인터페이스의 10개 조회 메서드.
- Step 2: mongoOperationStore.ts 선택 모델집합/파생 _id validator, mongoReadStore.ts domain별 setup/readiness. 기존 Operation 기본 7모델 유지.
- Step 4: mongoReadStore.test.ts, mongoTeamMemberRepository.test.ts, mongoCoachRepository.test.ts, mongoCoachRepository.integration.test.ts, mongoCoachFixtures.ts.
- Step 5: execution-review.md 독립검토. 최종전체789pass/7skip, lint0error/기존7warnings, type/buildpass. 실제엔진은 아래 별도 기록.
- 독립 복사 준비: Dockerfile.mongodb-shadow + dockerignore, scripts/run-mongodb-shadow-job.ts, shadowJobCommand.ts/test, docs/operations/mongodb-shadow-job.md.

## 서버 검증 전송
공개 origin c257b82281b04d591731842674a583998c77a4b4를 임시폴더로 clone후 검토한28개 source/script/Dockerfile overlay만 전송. base64 artifact SHA256 0f7f97d7124ec87fc79eed3a9162aafe5c9b6241afd1eb9bbc08cf670f301efa; 서버일치확인. 파일 .env/실키/실데이터없음.
검증실행폴더는 /tmp/hub-om-shadow-read-7hgrdx. Dockerimage hub-om-shadow-check:7hgrdx build EXIT0. 무인자job는SHADOW_JOB_CONFIGURATION_INVALID/EXIT1 확인.
Mongo8.0.32 컨테이너는 kernel7.0.0-28-generic TCMalloc 호환성guard로startupEXIT1. 이경로의native test는DockerEXIT125(실제test실행전실패). 운영서버커널/기존앱/DB는변경안함. Mongo7.0.43 보조검증중이며목표8.0검증과구분.

## 보조 실제 엔진 결과
7.0.43 image digest sha256:9854f7139445d766a9523571d6f047530c45547460ffcf8259eb2bf4264632ca. 초기컨테이너는 nofile제한으로EXIT14; 새컨테이너만 nofile65536으로조정했다. native7b.log는24pass/1fixturefailure/0skip이며Operation및Team통과, Coach는중복sourceIDfixture가원인.
고유키fixture와합성URLtemplate누락을수정후coach-verified.log는2pass/0fail/0skip,EXIT0. 제품schema/unique/URI설정변경없이test데이터/setup만고쳤다. 추가 암호화 반례·namespace 검증의 최종 통과 결과는 아래 최종 검증 및 execution-review.md에 기록했다.

최종추가native: coach-security.log 1pass/0fail/0skip,실제8메서드+키회전/키분실/AAD/tag/HMAC/companion/동일PKnamespace분리/읽기쓰기0검사. 파일SHA e3ea64aae0181b778fb55e62ca5f64d916ab7b2759f178a74e8a28547756a0c5 서버/로컬일치. fixture SHA587dad89a6fb5c25f0c319e296895674117515466a2d687c2de836b8076b1b90, mocked test SHA0baa8f330552639b8038a2f43a587edb4d0716b36be959292c0eca48940ebcf8. 중복실행 pass수를전체합계에더하지않음.
