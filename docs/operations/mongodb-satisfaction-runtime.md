# MongoDB 만족도 runtime

관리자 만족도 미리보기·자동 반영·수동 연결과 회차별 만족도 반영 API의 운영 저장소, 시트 원천, 요청 감사를 하나의 명시 Mongo shadow namespace로 조립한다. 생산 기본 backend와 실제 Google Sheets 연결은 유지한다.

빈 namespace만 준비하고 기존·부분 namespace는 read-only readiness에서 실패한다. 실제 MongoDB 8.0.30에서 네 API handler의 권한·매칭·기존 값 보존·두 만족도 필드 저장·요청 감사, PG·비합성 fetch 0, 재준비 mutation 0, legacy 부분 namespace의 validator·index·문서 불변, 세 포트 누락·다른 namespace 혼입 차단을 확인했다.

실제 Google Sheets·운영 만족도 반영, production selector, 데이터 이전·복원·최종 전환은 실행하지 않았다.
