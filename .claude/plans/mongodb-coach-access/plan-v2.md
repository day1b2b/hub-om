# 코치 접근 경계 계획 v2
목표: 기존 PG 운영을 유지하면서 코치 링크 인증/본인조회/개인정보 내보내기/링크 재발급을 Mongo shadow로 실제 handler 검증. 사용자 추가 입력 없이 실행.
R1/R2/R4/R5/R6 = 5, Level3. schema/env/dependency/운영데이터/배포 미변경. 매니저 마이페이지 coachMyPage.ts는 별도 범위.
1. [Core] 토큰 조회/본인 DTO repository: 기존 토큰 추출 우선순위, deletedAt 필터와 상태 동작 유지. Mongo blind-index 조회+복호화 후 정확값 비교. 완료 archive 최신값과 태그 조합 유지, 민감필드/토큰 응답 제외.
2. [Core] 개인정보 export repository: 기존 auth/CSV컬럼/BOM/normalizedName 이름정렬 유지, 중복 ID 제거 및 삭제제외. Mongo transaction에서 선택코치/PII 조회와 암호화 접근감사 원자 처리, 감사 실패시 CSV 반환 금지. PG 기존 동작 adapter추출. 입력을 통한 임의 저장소 선택 금지.
3. [Core] 토큰 재발급: 기존 auth/응답 유지, 원자 수정 및 변경감사, oldtoken 무효·newtoken 성공·deleted 거절. 실제 tokenAuth 공유 모듈과 경계 factory 연결.
4. [Shell] 요청context에 서비스3개 추가(root 담당). no-context 기본 PG, missing scoped service failclosed. 새 서비스는 shadow prepare/open만 제공.
5. [Check] 실제route+합성세션/native8.0검증, 잘못된/삭제된 토큰과 PII권한 실패, 암호문/감사실패 rollback, 독립리뷰, 전체회귀/type/lint/build, 문서/commit/push.
대안: route별 Mongo 분기 직접 추가 vs repository 추출+context. 후자는 운영PG를 유지하며 검증분기 누락을 차단하므로 선택. DB권한/실제복사/운영UI/OAuth는 미검증으로 보고.

## v1 검토 반영
재발급은 삭제코치에 양 backend 동일404를 적용하는 보안보완이다. CSV는 trimStart 후 =+-@ 또는 최초tab/CR/LF 선두를 apostrophe로 문자열화한다. 정당한 +전화번호도 스프레드시트의 수식 해석을 막는 접두가 들어가며 문서와 테스트로 명시한다. 본인조회는 token재검증과 archive/태그를 snapshot에서 읽고 응답에는 token/PII를 포함하지 않는다. 이미 진행 중인 snapshot요청을 후속 토큰회전으로 취소한다는 보장은 하지 않는다.
