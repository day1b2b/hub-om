# 강사 위키 쓰기 composition 인계

`INSTRUCTOR_WIKI_BACKEND`의 기본값은 PostgreSQL이고, `mongodb-shadow`에서만 준비된 Mongo namespace를 연다. 두 route는 `instructorNote`와 `requestActivity`를 한 scope에서 사용한다. 기존 Notion 동기화와 공개 위키 조회 selector는 별도 경계를 유지한다.

운영 설정은 변경하지 않았다. 운영 데이터·실제 Notion·Atlas에 접근하지 않았고, production 배포와 실제 shadow 복사·A/B 복원·최종 전환은 남아 있다. 첫 총괄 통합 SHA는 `7297de01ce1b8f6b5a1323c51264137b1cdca184`다.
