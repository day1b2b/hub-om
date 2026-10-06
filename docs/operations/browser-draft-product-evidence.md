# 실제 제품 초안 브라우저 검증 (합성)

2026-09-21. `/scripts/draft-product-fixture`가 실제 세 editor·Providers·BrowserDraftProvider·runtime·암호화·native IndexedDB를 번들한다. NextAuth/Google/session/router/업무 API만 가짜이며 `.next`, 실제 DB, 실제 개인정보·키는 사용하지 않았다.

- PASS: 가상 A 로그인 → 세 폼 작성 → fixture HTTP 프로세스 실제 종료 → 세 폼 추가 입력 → 세 종류 최신값 암호화 저장/복호화 확인.
- PASS: 서버 종료 상태에서 session 조회 실패(data=null/unauthenticated) 모의 후에도 열린 화면 ready key와 초안 저장 유지.
- PASS: raw IDB 3개 레코드 검사에서 합성 개인정보 마커 및 keyBase64/wrappedKey/secret 필드 없음. localStorage에는 비개인정보 lock epoch만, sessionStorage 비어 있음.
- PASS: 새 탭/새 runtime은 잠김(세 폼 미표시). 서버 복귀·동일 A 연결 후 회고/Drive 자동복구, 강의관리 복원 버튼으로 마지막 링크 복구.
- PASS: 실제 native IDB에 두 runtime/연결이 같은 missing revision으로 동시쓰기 → 하나만 성공. 이후 구 revision 삭제 거부, 최신값 유지.
- PASS: 두 준비된 탭 중 하나에서 명시 logout → 양쪽 세 폼 unmount 및 입력 비표시. B 로그인 후 세 폼 빈값, A 초안 미노출.
- 단위 검증: key/API16, account store9, runtime7, 기존3폼 관련16(각 시점 기준). 모든 최신 전체검증은 총괄 로그를 따른다.
- 한계: 실제 Google OAuth·Coolify·실DB·브라우저 프로세스 완전 종료·OS 재시작 미검증. 계정 인증은 합성 endpoint/mock이고 DB4개 통합테스트 skip. owner 미정 legacy는 원본 보존/존재만 안내, 전환 결정 미해결. 신규등록4번째 UI 검증은 기능 담당 별도 증거.

## 세 폼 복구와 native CAS 결과

```text
- heading "실제 초안 컴포넌트 합성 검증" [level=1]
- paragraph: 제품 컴포넌트·Provider·runtime·IndexedDB를 사용하며 로그인과 업무 API만 가짜입니다. 실제 데이터는 입력하지 않습니다.
- button "가상 A 로그인"
- button "가상 B 로그인"
- button "현재 계정 재연결"
- button "모든 탭 로그아웃"
- button "세션 조회 네트워크 실패 모의"
- button "현재 가짜 초안 검사"
- button "다음 생성 실패"
- button "다음 생성 응답 유실"
- button "가상 생성 통계"
- button "실제 IDB 동시 저장 충돌 검사" [active]
- button "영속 암호문 검사"
- paragraph
- generic "합성 검사 결과": "{\"atomicOneWinner\":true,\"staleDeleteRejected\":true,\"latestPreserved\":true,\"latestRevisionMatches\":true}"
- table:
  - rowgroup:
    - button "등록"
    - dialog:
      - region "강의관리":
        - heading "강의관리" [level=2]
        - paragraph: 강의가 어떻게 진행되었는지 기록합니다. 입력한 내용은 자동으로 저장됩니다.
        - button "강의관리 닫기": 닫기
        - text: 강의관리 링크
        - textbox "강의관리 링크":
          - /placeholder: https://...
          - text: https://example.test/synthetic-lecture-offline
        - generic: 서버에 저장하지 못했습니다. 잠시 후 자동으로 다시 시도합니다. 저장될 때까지 창을 유지해 주세요.
        - button "다시 저장"
        - button "닫기"
- generic: 특이사항 / 이슈
- textbox "특이사항 / 이슈":
  - /placeholder: 이 과정의 특이사항, 이슈, 후속 조치 등
  - text: 합성비밀 서버중단 뒤 회고
- generic: 회고 (OM+LD)
- textbox "회고 (OM+LD)":
  - /placeholder: 과정에 대한 회고 (강사, 고객사와 회고 나눈 내용도 포함)
- generic: 메모
- textbox "메모":
  - /placeholder: 업무 중 자유롭게 활용
- generic: 오후 08:09 임시 저장됨 · 나만 보임, 아직 반영 안 됨
- text: 저장하지 않은 개인 초안을 불러왔습니다
- button "작성 취소"
- button "저장하기"
- textbox "Drive 폴더 URL": https://drive.google.com/drive/folders/synthetic-offline
- button "폴더 후보 찾기"
- button "입력한 폴더 확인"
```

## B 계정 화면

```text
- heading "실제 초안 컴포넌트 합성 검증" [level=1]
- paragraph: 제품 컴포넌트·Provider·runtime·IndexedDB를 사용하며 로그인과 업무 API만 가짜입니다. 실제 데이터는 입력하지 않습니다.
- button "가상 A 로그인"
- button "가상 B 로그인" [active]
- button "현재 계정 재연결"
- button "모든 탭 로그아웃"
- button "세션 조회 네트워크 실패 모의"
- button "현재 가짜 초안 검사"
- button "다음 생성 실패"
- button "다음 생성 응답 유실"
- button "가상 생성 통계"
- button "실제 IDB 동시 저장 충돌 검사"
- button "영속 암호문 검사"
- paragraph
- generic "합성 검사 결과"
- table:
  - rowgroup:
    - button "등록"
- generic: 특이사항 / 이슈
- textbox "특이사항 / 이슈":
  - /placeholder: 이 과정의 특이사항, 이슈, 후속 조치 등
- generic: 회고 (OM+LD)
- textbox "회고 (OM+LD)":
  - /placeholder: 과정에 대한 회고 (강사, 고객사와 회고 나눈 내용도 포함)
- generic: 메모
- textbox "메모":
  - /placeholder: 업무 중 자유롭게 활용
- button "작성 취소" [disabled]
- button "저장하기" [disabled]
- textbox "Drive 폴더 URL"
- button "폴더 후보 찾기"
- button "입력한 폴더 확인" [disabled]
```
