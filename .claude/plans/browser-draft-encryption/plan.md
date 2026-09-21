# 브라우저 초안 암호화 후속 계획

사용자 최신 정정에 따라 서버와 브라우저 초안 모두 완료 조건이다. 앞선 pii-encryption-followup 문서의 브라우저 범위 제외는 철회되었다. 기존 서버 구현은 유지한다.

1. 공식 Web Crypto/WebAuthn/Storage 문서로 키 대안 비교. 별도 사용자 암호 wrapping 추천. 사용자 암호 UI 결정은 총괄 질의 대기이며 승인 전 실제 폼/기존 초안 변경 금지.
2. DB·API·실제 데이터 없는 독립 crypto/store 및 정적 복구 shell prototype. 비추출 CryptoKey 한계도 동일 origin 가짜 데이터로 시연.
3. 브라우저 스킬로 online 저장→server 중단→추가 저장→tab 닫기→새 tab offline shell→암호 unlock→복구. 앱 runtime 재시작이 아닌 tab 재생성의 증거를 구분한다.
4. 가상 A/B 전환, 키 잠금/분실, 변조, IDB abort/저장 실패, legacy owner unknown/중간 실패 확인. 프로토타입이 앱 인증 검증을 대신하지 않음을 명시한다.
5. 사용자 승인 후 실제 폼/로그아웃/복구 화면 최소 통합 및 동일 테스트. 미승인 상태에서는 독립 코어만 준비하고 전체 완료 선언하지 않는다.

제약: real DB/사용자 데이터/키/배포/push/merge 금지. fake passphrase/fixture key만. 새 deps 없음. 동일 origin XSS·기기 관리자·브라우저 데이터 삭제/eviction 보호를 암호화 자체로 보장하지 않음.

현재: 1~4 독립 프로토타입 범위 완료. 경합/strict durability 회귀와 v2→v3/설치 실패/서버 종료 후 탭 복구 검증 완료. 5는 사용자 결정 대기. 인계 근거는 handoff.md 및 browser-evidence.md.
