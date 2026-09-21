# 실제 제품 초안 컴포넌트의 합성 브라우저 검증

`node scripts/draft-product-fixture/bundle.mjs`는 설치된 Next의 webpack과 TypeScript만 사용해 `/tmp/hub-om-draft-product-fixture/bundle.js`를 만든다. `.next`를 쓰지 않는다. `node scripts/draft-product-fixture/serve.mjs 41877` 실행 후 가짜 계정 UI로 시험한다. 41876은 신규등록 담당과 공유할 수 있다.

실제 코드: 세 editor, 신규등록 Form(`?form=create`), Providers/BrowserDraftProvider, runtime, 암호화, native IndexedDB. Mock: NextAuth session, Google 로그인, router, 업무 API. 합성 endpoint는 실제 키설정이나 DB를 읽지 않고 고정된 공개 시험용 byte 배열로 계정키를 파생한다. 실제 고객·키·계정 입력 금지.

가상로그인→세 폼 입력→autosave commit→서버 종료→열린 화면 입력 추가→서버 재시작/페이지 새로고침(잠김)→같은계정 재연결→복구. 다른탭 logout와 B로그인 시 제품 폼이 A 초안을 숨기는지 확인한다. 실제 IDB 충돌 버튼은 별도 runtime/연결의 동시 put 중 하나만 성공하고 stale delete가 최신 암호문을 보존하는지 검사한다. inspector 출력도 합성값만 사용한다.

서버 재시작 시 신규등록 fixture의 receipt 통계는 초기화된다. 신규등록 응답유실 재개 검증에서는 서버를 중단하지 말고 '다음 생성 응답 유실' 버튼을 사용한다. 실제 Google/OAuth, Coolify, 실DB, 물리디스크 소진 검증은 아니다.
