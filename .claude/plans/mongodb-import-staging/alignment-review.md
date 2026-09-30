# 상위 계획 정합 검토

상태: V1~V8 및 V9 실행·정리·증거 보존 독립 수락. 제품 c11a05c의 총괄 FF·원격 통합도 확인했다. 다음 별도 Task로 진행한다.

사용자 목표는 기존 기능·권한·개인정보 보호를 유지한 Mongo 이전이다. 이번 수직 단위는 파일 업로드→staging→목록·상세 검토까지다. 35모델 codec이나 개별 repository 완성을 전체앱/운영전환으로 확대하지 않는다. 기본PG·parser·권한·업무schema·삭제정책과 원본workspace/운영설정은 유지한다.

의도적인 차이는 업로드의 비정형 오류 본문을 고정문구로 가리는 것이다. 승인된 화면의 복호화 값은 그대로다. 기존 두 staging 모델의 변경감사 제외와 요청감사 best-effort도 유지한다. 잘못된 HMAC키가 sourceName 검색 miss로 숨지 않도록 sourceType 후보 인증을 추가했으며, 따라서 기존 scan 한계가 해당 후보 전체에도 적용된다.

Level3 sizing은 적정했다. 실제 PG 원본이 보장하지 않는 시각 선후 가정, exact오류/환경별명단 검증 공백, 과거합성주소에 고정된 회귀검사를 실제 근거로 발견했다. 검증기준을 낮춰 PASS를 만들지 않고 계약을 확인하고 검사 공백을 보완했다. 제품 변경 없이 시간초과가 난 기존 묶음은 원래 제한으로 별도 재실행해 통과했다.

Alignment outcome: update_next_task. 다음은 별도 운영 승격 단위이며 회사/과정/운영/source link의 단일transaction, 기존삭제복원/중복, sequence/감사, commit후Calendar를 다룬다. 사전계획은 /private/tmp/hub-om-import-staging-20260930/promotion-plan 에 있으며 선행통합후 프로젝트 계획폴더로 옮긴다. 이어 실원천·Drive·Calendar저장잠금·활동쓰기/보존·backup/health·전체앱구성을 진행한다. 구체적 남은 경계는 next-scope.md에 있다.

실제 독립A/B백업·복원·최종복사·무손실복귀·운영전환 증거는 여전히0이다. 사용자 dev→main 요청은 전체완료조건 충족 후 실행할 후속이며 현재 개발검증만으로 실행하지 않는다. 브라우저 임시초안 암호화는 별도후속, 운영 DB와 필수파일 보호는 필수다.
