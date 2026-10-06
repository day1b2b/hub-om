# 파일 가져오기 임시 저장·검토의 Mongo 경계

2026-09-30. `feature/20260930-mongodb-import-staging`, 기준 `8e19638`. 최종 수락·회귀·통합 상태는 `.claude/plans/mongodb-import-staging/`의 실행·통합 기록을 따른다.

## 바뀐 경계

업로드 API와 관리자 목록·상세 페이지가 명시적인 `imports` context를 사용한다. 명시 context가 없으면 기존 PostgreSQL을 사용한다. 업로드의 workspace 권한과 두 페이지의 관리자 권한은 그대로다. 파일 parser·화면 DTO·기존 업무 모델과 삭제 정책을 바꾸지 않는다.

Mongo 저장에는 `imports`, `teamMembers`, `instructorNote`가 필요하며 실제 API에는 기존 `requestActivity`도 필요하다. 누락되면 PostgreSQL·로컬 파일·Notion으로 대체하지 않는다. 기존 일반 명단 factory와 달리 context 밖 업로드의 명단·강사 조회는 이전처럼 PostgreSQL 고정이다.

CSV·JSON·XLSX 첫 시트의 읽기와 5MiB 제한, 팀/파일/연도 기본값, 오류 행 보존을 유지한다. 중복 판정은 원천 이름·종류·팀·행 지문으로 한다. 같은 업로드 내 첫 행을 보존하고, 재실행은 원천 행 없이 중복 로그를 가진 새 run을 만들 수 있다. 두 요청 모두 상대 commit 전에 중복 조회를 마쳤다면 각각 저장될 수 있다. 이는 기존 PG 계약이며 새로운 전역 중복 방지 정책을 추가한 것이 아니다.

목록은 시작 시각과 UUID 역순, 상세는 복호화한 시트명의 한국어 순서와 행 번호순으로 최대 200건이다. 전체 건수와 미리보기 8/12개 제한, 연결된 삭제 표시 운영의 표시를 보존한다. 필수 연결 대상이 없거나 암호문/HMAC이 손상되면 부분 결과를 반환하지 않는다.

## 암호화와 실패 처리

기존 35모델 codec·validator·HMAC index를 사용한다. 원천 이름의 HMAC 검색 전에 공개 sourceType 후보를 인증하고, 검색 결과의 원문과 후보 집합을 확인한다. 잘못된 index 키가 조회 실패로 숨은 채 중복 저장을 유발하지 않도록 한다. 따라서 같은 sourceType의 누적 run에도 기존 scan 한계가 적용된다.

run과 source rows는 한 snapshot transaction이다. 확정 abort는 원시 저장 상태를 그대로 유지한다. commit 응답 유실은 이미 전체 반영됐을 수 있어 자동 삭제나 rollback으로 해석하지 않는다. 요청 감사는 별도 best-effort이고 실패해도 이미 commit된 staging을 취소하지 않는다. 두 staging 모델은 기존 mutation 감사 제외 대상이다.

승인된 화면 응답은 복호화 값을 표시한다. 저장 문서·감사·오류에 평문을 남기는 것과 구분한다. 업로드 오류는 정확한 네 개의 기존 공개 parser 문구만 허용하고, 비정형 parser/driver 오류는 고정 문구로 가린다.

## 한계와 후속

- scan당 20,000행·32MiB·15초, 읽기 전체 30초·쓰기 전체 60초. retry가 전체 기한을 초기화하지 않는다. 한계 초과는 오류이며 일부 저장을 성공으로 반환하지 않는다.
- 준비되지 않은 validator/index는 자동 수리하지 않는다. 준비 도구는 명시 shadow에서만 사용한다.
- 운영 데이터 반영(promotion), 실제 Sheets/Notion 원천, Drive 기록, Calendar는 후속 별도 경계다. 현재 Mongo context의 PG promotion 진입은 차단된다.
- 실제 브라우저 렌더링 검증은 이 단위에서 하지 않았다. 실제 서버 페이지 함수를 호출하고 UI props/권한을 대조했다. 전체 앱 연결과 브라우저 흐름 검증은 후속 필수다.
- 생산 기본은 PG다. 운영 데이터 복사·실제 백업·복원·최종 전환은 실행하지 않았다. 브라우저 임시 초안 암호화는 별도 후속이다.

## 합성 검증 증거

원본 PG reader/writer를 기준 SHA에서 바이트 그대로 동결했다. 실제 격리 PG17.9와 Mongo8.0.30 replica set에서 원본 PG·현재 PG·Mongo 3방향 결과, 중복/재실행/동시 요청, DTO·정렬·200건 경계, 암호화·실패 원자성을 비교한다. native 테스트의 키/암호문 손상, 시계·driver 오류 주입은 실제 서버 장애와 구분해 이름에 명시한다. 실제 standalone 서버는 실행하지 않았고 replica 서버의 hello 응답 주입으로 거부 분기를 확인했다. 최종 검사 수치와 미검증 항목은 실행 기록 기준이다.
