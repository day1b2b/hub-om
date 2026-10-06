# 활동 조회의 Mongo 병렬 경계

관리자 활동 조회, 비공개 피드, 날짜별 사용 통계 세 GET는 ActivityReadRepository를 사용한다. 기본 backend는 PostgreSQL이고 내부 activityReads context에서만 Mongo를 주입한다. 관리자/피드 Bearer 인가, 파서, 상태·오류 문구·headers, 화면과 기록 쓰기·보존 정책은 유지한다. 요청 파라미터로 backend를 선택하지 않는다.

## 검색과 집계

이메일 부분 검색은 기존 PG 개인정보 wrapper처럼 복호화한 원문의 JS 소문자 부분 일치다. HMAC exact 검색으로 바꾸지 않는다. 사용자 수는 인증된 원문 HMAC의 고유값 수이며 대소문자·공백·빈 문자열을 합치지 않고 null만 제외한다. 일반 조회의 공백 이메일과 legacy의 빈 contains는 원본처럼 구분한다.

공개 route 검색은 PostgreSQL LIKE의 %, _, 역슬래시 및 Unicode·개행 의미를 유지한다. 서버 후보는 변환한 정규식과 남은 조회 기한을 사용하고, JS 재평가는 Unicode code point 단위 동적 계획법으로 수행한다. 서버 정규식까지 없어진 것은 아니다. 암호화된 과거 콘텐츠의 접두어는 복호화 후 literal startsWith로 검사한다.

관리자 요청 목록은 모니터링 API를 제외하지만 피드는 포함한다. 피드 요약은 기간/이메일/실행 주체만 반영하여 목록 cursor·경로·작업·대상 필터와 독립적이다. 사용 통계는 사람/토큰 요청에서 모니터링을 제외하고, 변경 수는 해당 한국 날짜의 사용자 변경 전체를 센다.

50개 반환/51번째 다음 페이지 판정, 시각과 UUID의 내림차순 cursor를 유지한다. 삭제된 cursor 행을 다시 읽지 않는다. 대상 ID는 일반 문자열이며 UUID 조회 뒤 원본 formatter의 정확 문자열 비교도 보존한다. 현재 대상 정보가 없으면 redacted가 아닌 기록 당시 이름을 사용한다. 삭제된 코치는 이름만 표시하고 링크를 만들지 않는다. 남은 대상의 필수 관계가 깨졌으면 Mongo는 안전 실패한다.

## 읽기 안전성과 차이

각 Mongo 메서드는 하나의 snapshot transaction으로 후보·관계·집계를 순차 조회한다. 전체 행을 codec으로 인증한 후 조건을 평가하고 응답 필드를 명시한다. HMAC/암호화 companion은 반환하지 않는다. 키/HMAC/JSON 손상, 준비되지 않은 validator/index, 미지원 조건은 부분 결과나 PG fallback으로 숨기지 않는다. open/read는 데이터나 schema를 수리하지 않는다.

모든 조회·정렬·집계·formatter·재시도는 메서드 진입 시 고정한 8초 예산을 공유한다. transaction와 session 종료 후에도 확인하여 기한 초과 결과는 반환하지 않는다. 동기 계산을 즉시 중단하거나 정확히 8초 안에 응답한다는 보장은 아니다. 각 scan은 32MiB BSON/20k행/15초와 남은 전체 기한 중 빠른 제한을 적용한다. scan별 제한이며 메서드 총메모리 상한은 아니다. BSON 응답 크기로 짧은 페이지가 와도 마지막 실제 ID부터 빈 페이지까지 읽는다.

PG 공개 count/groupBy에는 같은 scan 제한이 없고, PG private 검색은 선택 필드의 JSON 크기를 측정한다. 따라서 Mongo 전체 행 제한은 더 엄격하여 넓은 조회가 503으로 실패할 수 있다. 운영 규모 적용 전 이 한도와 데이터 규모를 확인해야 한다. PG 관리자 목록과 label은 독립 읽기였으며 Mongo 단일 snapshot은 보장 강화다. 피드/통계의 PG RepeatableRead와 생성 시각 위치는 유지한다.

## 검증과 남은 범위

원본 39c70e2 query·파서·formatter를 동결한 독립 oracle로 PG 원본/새 PG/Mongo 각각 81개 상황을 대조했다. 실제 PG 6pass, native 30pass, 실제 handler 10pass; 원문 검색·집계·label·snapshot·손상 차단과 raw 읽기 불변을 확인했다. 일반901pass51skip, 전체Mongo497pass0skip(mock4포함), typecheck/build PASS, lint0error/기존7warning, 독립V1–V8 PASS와 소유 합성 자원 정리를 확인했다. 원격 통합의 최종 상태는 `.claude/plans/mongodb-activity-reads/`를 따른다. 중복 검사 묶음은 합산하지 않는다.

모든 대형 한도 경계와 실시간 8초 대기를 실행한 것은 아니다. 계측 주입·가상시간의 증거는 실행 문서에 구분한다. 실제 브라우저/OAuth·운영 부하·실데이터 복사·복원·최종 전환은 별도 미완료다. 운영 데이터·실키/env·배포를 변경하지 않는다. [전체 잔여 순서](mongodb-cutover-remaining.md)는 이 기능 단위와 실제 서비스 이전을 구분한다.
