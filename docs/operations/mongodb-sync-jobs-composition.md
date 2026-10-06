# 코치 동기화 예약 작업 Mongo composition

코치 Notion·계약·일정·전체 동기화 API의 GET/POST에 `COACH_SYNC_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`에서만 준비된 코치 동기화 runtime을 open-only로 연다. 저장 repository, Notion·Google source port, 실행 로그와 요청 감사를 같은 잠금 namespace에서 사용한다.

실제 MongoDB 8.0.30 replica set에서 `/api/sync/all` POST export가 selector를 직접 읽어 새 client와 기본 source adapter를 통과하도록 검증했다. 외부 HTTP는 합성 RSA 서비스 계정과 URL별 가짜 Notion·Google 응답으로 제한했고 PostgreSQL 접근은 0건이었다. 네 API의 여덟 export가 공통 경계를 사용하는지, 준비 재실행 무변이와 부분 namespace의 callback 0회·validator/options/index/문서 전체 불변도 확인했다.

실제 Notion·Google Sheets·Coolify 예약·production 배포·운영 데이터·A/B 백업과 복원·복사·최종 전환은 미완료다.
