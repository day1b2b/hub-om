# 현재 원본 계약

기준74e1970. omRequestAssignment.ts, assign route, AssignForm.tsx, omRequestAssignmentAccess.ts 직접읽음.

- requireDatabase→normalizedInput→Serializable/readAssignmentState→signature/confirmToken→changed operations→request→return.
- existing DTO 반환은 최신 request 전체 재매핑이 아니라 existing spread. 서비스와 실제route에서 같은계약유지.
- preview10분 HMAC은canonical actor/nextOm/선택한request snapshot/operations snapshot을서명. no-store,이름은body/응답만,token은만료+HMAC만. secret없는경우500/서명발급불가.
- 조건: 생성metadata request정확히1, 같은batch내request정확히1,operation UUID/중복0/일정수일치/대표포함/삭제0. changes값읽지않음. 생성배치밖에추가된같은과정회차제외.
- 이름/계정전체덮어쓰기,취소둘다비움. needed→planned 및취소planned→needed만, DONE/다른상태유지.
- 선택OM이명단에있어야한다는서버강제검증없음(클라이언트경고만). 신규정책추가금지.
- 권한:canManageOmRequestAssignment의로그인이메일+파트관리자명단유일성+기존override. 일반admin역할만으로권한부여안함. POST/PATCH모두재평가.
- route순서 로그인→bodyshape→getrequest→권한→preview/confirm. calendar/notify는commit후,각실패best-effort. Slack rawerror노출은고정문구로수정대상.
- 기존confirmed서비스만개방. 확인없는 request-only/same-course helper는계속차단.
- 원본권한검사와tx는분리되어있음;새로role정책/락범위변경하지않고한계를문서화.
- 이전readonly조사에서A→writer로직렬화가능한one-way 경쟁을실패로간주하지않기로함. 이번엔two-way cycle/실DB근거가필요. 신규schema/정책없이가능한대안부터검토중.
