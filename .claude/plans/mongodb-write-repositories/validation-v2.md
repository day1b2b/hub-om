# 검증 v2
S1 태그, S2 Core>=1, S3 결정 가능한 규칙; 구조 fail 시 결과 평가 중단.
## 계약 의미 (기존 화면 동작 유지)
1. 코치 생성 후 name/normalizedName/token/profile/tags가 일관되고 DTO에 비공개 값 없음.
2. TeamUser 생성 중복 정규화 검사 및 팀/역할 수정이 기존 반환 의미와 일치.
3. InstructorNote 동명이인·null NO·NO 변경·빈 값·누락 필드의 기존 우선순위와 일치.
4. 없는/삭제된 대상은 기존 null/404상응 실패이며 임의 신규 생성하지 않음(명시 upsert 제외).
5. 기존 optional 날짜의 빈값·형식불일치는 null 정규화를 유지한다. 정규화 이후 Invalid Date 또는 잘못된 필수 입력·암호문은 안전한 오류로 실패하고 부분 변경 안 됨.
## 보안·원자성
6. 전체 쓰기 codec 사용, 필수 PII 평문/민감값 오류로그 유출 없음.
7. 트랜잭션 관련문서 갱신 rollback과 서로 다른 부분수정 보존.
8. 동일 정규화 이메일 신규생성 경쟁은 최대 한개 성공(guard 사용), notionNo unique 경쟁 처리.
9. 준비 누락/replica 미지원/namespace·DB 잘못됨/writegate 없음은 차단.
10. 키누락·기존 암호문 변조 시 저장 전에 실패하며 저장문서 복구 검증 가능.
## 검증·출시 범위
11. 표적·전체테스트 및 타입/build/lint 실제 결과·생략 수 기록.
12. native suite 합성 전용/loopback gate, unit와 실엔진 통과 구분.
13. 생산 factory/routes/PG 업무 schema/의존성/운영 데이터 미변경 확인. 승인된 shadow 내부 guard schema는 예외이며 명시 setup에서만 준비.
14. TeamUser 물리삭제 정책과 남은 API/auth/activity/runtime 경로를 gap으로 명시.
15. 독립 리뷰와 결과 manifest·alignment·handoff 존재, 전체 이전/배포 완료로 오인 보고 금지.
판정: 실행증거가 없으면 pending/미검증. 실엔진만 증명 가능한 rollback/동시성은 mock으로 완료 인정하지 않는다.
