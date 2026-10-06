# 코치 공개 화면 Mongo composition

코치 목록·일정·상세·투입과 강사 위키 목록·상세 화면에 `COACH_PUBLIC_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`에서만 준비된 runtime을 open-only로 연다. 인증을 먼저 완료한 뒤 `operations`, `instructorNote`, `coach` 세 저장소를 같은 잠금 namespace에서 사용한다.

실제 MongoDB 8.0.30에서 여섯 화면의 조회·404·인증 선행과 기존 7페이지 계약을 실행했다. PostgreSQL 접근은 0건이고 조회 전후 collection 정의·validator·index·문서가 같으며, 부분 namespace는 자동 준비·수리 없이 callback 전에 거부됐다. operation 상세는 기존 `OPERATION_PAGES_BACKEND` 경계를 계속 사용한다.

운영 데이터·production 배포 설정·브라우저 전체 흐름·실데이터 이전·A/B 백업과 각 복원·최종 전환은 실행하지 않았다. 생산 기본은 PostgreSQL이며 이번 기능군 완료는 전체 앱 전환 완료가 아니다.
