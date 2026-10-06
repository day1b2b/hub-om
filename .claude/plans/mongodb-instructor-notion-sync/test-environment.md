# 소유 검증 자원

2026-09-29 실제버전확인: Node24.19.0,PG17.9,Mongo8.0.30. 운영PG18과버전차이명시. env-i와임시합성키사용,프로젝트env파일미로딩.

소유root /private/tmp/hub-om-instructor-notion-20260929, run.sh/logs보존. PG127.0.0.1:56689 DB instructor_notion_parity / role synthetic; Mongo127.0.0.1:27789 replicaset instructornotion20260929. 새dbpath pg/mongo만생성,setup exit0. Mongo namespace hub_om_shadow_*만사용. 최종검증뒤정상종료및정확히소유한두dbpath만정리완료. cleanup exit0/남은합성DB0/두경로부재확인.

원본sha256:
- notionInstructorSync.ts c407e62d6e6ccd2d10c51ea25c81472c6fe690160fa3557846b70a76e20e144e
- notionInstructorMap.ts 51e92992c1eb726f085ef72fc298b1926bd9f618ddfc4c428b2258fe3fc07bef
- instructorNotePii.ts 105b9f69ed6cb915dc3f96286ff406ba3f692a8efa13456f6582d6afc3406eb8

문서조사중없는추정파일경로의rg검색exit2가있어rg--files로실제경로확인후재조회했다. 실제privacy정책은src/lib/privacy/fields.json,API경계테스트는mongoApiContext.integration.test.ts. 제품/검증실패로통과처리하지않음.
