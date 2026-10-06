# 가짜 데이터 브라우저 검증 fixture

제품에 연결되지 않은 독립 프로토타입. 실제 고객 데이터·계정·암호를 입력하지 않는다.

`node scripts/privacy-browser-fixture/serve.mjs`로 127.0.0.1:41873만 열고 브라우저 스킬로 UI를 조작한다. 앱/DB/API/env 로딩 없음. 새 의존성 없음(기존 TypeScript로 두 브라우저 모듈만 transpile).

가상 보관함 설정→합성 초안 암호화 저장→최소 복구 화면 준비→이 서버를 종료→열린 탭에서 저장→탭 닫고 URL 다시 열기→같은 테스트 암호로 unlock→복구. 서비스워커는 고정 shell 파일만 캐시하며 업무 API/원문은 캐시하지 않는다. v3 준비 버튼은 실제 활성 controller와 고정 자산을 확인한다. 프로토타입 코드 변경 후 캐시 버전을 올리고 SW update 활성화 및 reload가 필요하다. 업데이트 실패 검증 버튼은 자산 적재 후 후보 설치를 의도 실패시켜 기존 worker/cache 보존을 검사한다.

`비추출 키 보관 한계 검증`은 별도 fixture IndexedDB에 테스트키를 저장하여, export가 거부돼도 같은 origin에서 decrypt 가능함을 보여준다. 실제 암호화 보관함의 원시 키를 저장하는 기능이 아니다.

`기존 가짜 초안 전환 검증`은 고정 합성 legacy 값만 테스트 localStorage에 넣고, owner 미확인 보존 및 명시 확인 후 전환을 검증한다. 실제 앱 초안 prefix에 접근하지 않는다. 임의 사용자 자료를 이전하는 도구가 아니다.

실제 브라우저 프로세스 재시작/OS offline/NextAuth 계정 변경과 quota 실용량 초과는 별도 검증 대상이다. 문서: docs/operations/browser-draft-encryption.md.
