# 발견 및 보완
1. Plan1 S3 불명확: 두 역의존 cycle과 실제 writer 판독 후 기존 CourseNameRestoreGuard 공유로확정. 다른writer전면연결/업무암호문touch추가안함.
2. 엔진spike: Mongo changed-row만쓰면두배정cycle혼합성공,PGSerializable는40001. 앱검증은별도.
3. 첫 focused 29pass1fail: 이전접수단위의전체배정미지원409 기대가새서비스필수port누락에따른닫힌오류로변경됨. 실제PGfallback0/업무쓰기0을유지하면서OmAssignment필수누락오류로테스트변경,옛helper2개계속차단. 새완성서비스실handler검증은별도.
4. Node --test에대괄호포함UI경로를전달하면파일glob로해석되어UI5개가실행목록에서빠짐. 직접파일실행으로AssignForm5pass확인; 일반30개에합산하지않음.
5. 실제기존guard경쟁2방향/최초guard경쟁은모두native112(3건)로성공. native11000은관측0건. 최초문서경쟁안전성은native증거,11000분기자체는별도fault-injection으로표기(실서버11000관측으로허위PASS금지). commit응답유실도drivercommit함수fault-injection으로native112와구분.

## 2026-09-30 재개 후 새 증거
- 이전 임시 로그/DB/proc가 사라져 전체 검증을 새 격리 자원에서 실행한다. 이전 수치는 새 PASS가 아니다.
- Mongo metadata cursor의 getMore/transaction CSOT 문제는 singleBatch+keyset로 수정돼 있다. 새 102회차 사례에 confirm 감시와 마지막 페이지 중복 거절까지 보완했다. 보완 테스트의 findLast는 현 TS lib에서 실패해 reverse().find()로 바꿨다.
- PG oracle 초안의 runtime DMMF enum 목록은 비어 있어 실제 저장 결과 비교가 실패했다. 제품 codec을 재사용하지 않고 커밋된 Prisma schema의 enum/@map을 읽는 독립 변환으로 보완했다.
- Mongo public 두 메서드의 입력 오류가 동기 throw인 반면 기존 PG는 Promise rejection이었다. public 메서드에 async를 추가해 원본 비동기 계약을 보존했다. 요청 권한/저장 정책 변경은 없다.
- 새 fullMongo 첫 실행은 env-i PATH에서 rg를 찾지 못해 URI 전달이 누락됐다(5 pass/44 skip). 수락 증거가 아니다. 검증 스크립트에서 rg 절대 경로를 써 opt-in URI를 다시 전달했다.
- 처음 다운로드의 aarch64 URL은403. 공식 arm64 archive URL로8.0.30 다운로드/실행 성공. 앱 package/lockfile 변경 없음.
- PG oracle의 runtime DMMF에는 isList도 없어 educationDates 배열을 단일 Date로 잘못 바꿨다. schema에서 list 선언을 독립 판독하도록 보완했다. 비교 항목을 제거하거나 값을 숨기지 않고 빈 배열/순서/Date 타입을 보존한다. 수정 전44 pass/12 fail 기록은 수락 제외.

## 독립 검증 설계 리뷰의 P2 보완
Herschel이 제품 P0–P2 없음과 별도로 검증 공백 3개를 제시했다. 최종 수락을 보류하고 다음 증거를 추가한다.
1. 최초 guard11000 연속5회 종료, 재시도 전체16s+16s 시간 상한, 업무11000 재시도 금지.
2. 존재하지만 변조된 업무 validator/index·guard validator/TTL 거부 및 DDL/데이터 자동복구 없음. 비복제셋 응답은 hello fault injection으로 명시하며 실제 standalone 서버 검증으로 확대하지 않는다.
3. 실제 PATCH에서 transient callback·commit 재확인·미확정 commit과 외부 후속 횟수/시점/안전 HTTP 오류 연결.
부모가 native 테스트, 별도 executor가 handler 테스트를 맡고 검토자는 읽기 전용으로 결과를 다시 판정한다. 제품 정책을 추가하지 않는다. 결과는 execution-review에 기록한다.

P2③의 첫 handler 보완은 동일HTTPcontext 안의 후속 읽기 transaction까지 주입기가 관찰하여 session6!=1로2사례 실패했다. 배정 guard의 lsid와 ClientSession identity로 관찰/주입 범위를 제한하고 성공 커밋 뒤 감시를 종료했다. assertion을 완화하지 않았으며 재실행20 pass/0 fail/0 skip. 제품 코드는 추가 변경하지 않았다.
- 마지막 handler lint의 no-this-alias는 commit 주입 대상 ClientSession identity를 저장하는 검증 코드에서 발생했다. 해당 한 줄에 용도를 설명한 lint 예외만 추가했고 file lint0. 실행 코드와 이미 통과한20개 검증 동작은 그대로다.
