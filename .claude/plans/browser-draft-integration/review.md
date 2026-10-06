# 통합 검토 기록

2026-09-21 / `fix/20260921-browser-drafts-integration` / base `d2a9edc`

총괄 읽기 검토와 별도 리뷰 작업에서 아래 결함을 발견해 담당자가 수정했다.

| 확인 사항 | 보완 |
| --- | --- |
| 서버 owner ID와 브라우저 검증 형식 불일치 | 실제 서버 파생 응답을 runtime으로 가져오는 계약 회귀 추가 |
| standalone 내부 주소와 Coolify 공개 Origin 불일치 | 서버의 명시적 trusted origin 설정 및 내부 URL 회귀 |
| 계정 변경 후 passive effect 이전의 기존 초안 표시 | 렌더 시점 session subject와 runtime subject 비교 |
| 지연 저장 콜백이 계정 전환 후 실행 | 실행 직전 세대 검사 및 비동기 결과 검사 |
| 동일 계정 여러 탭이 신규 등록 재개 정보를 덮거나 삭제 | native IndexedDB 단일 strict transaction에서 암호문 CAS |
| 요청 직전 쿠키 계정 변경 | 암호문에 보존한 기대 계정과 서버의 인증 계정 일치 검사 |
| 키 발급 API 활동 수집 정책 누락 | activity route policy에 키 발급 명시적 제외 |

독립 재검토는 위 수정 후 추가 차단 결함을 발견하지 못했다. 이는 검토한 범위의 결과이며 전 서비스 보안 무결성을 보장하지 않는다. 별도 검토자가 서버·runtime·API 23개 및 runtime/store 10개 단위 테스트를 직접 실행했다. 총괄의 최종 전체 검증은 같은 디렉터리의 test/lint/typecheck/build 기록에 남긴다.

현재 배포 차단 사유는 기존 평문 초안의 소유 확인·안전한 전환 결정, 실제 인증/배포 환경 확인, 키 보관·복구 책임 지정이다. 운영 DB·키·배포·push·merge는 수행하지 않았다. 기존 사용자 checkout의 미커밋 변경을 수정하지 않았다.
