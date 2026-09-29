# 삭제 운영 목록·복원 인계

격리 clone `/Users/ga/workspace/hub-om-mongodb-coach-content`, 기능 브랜치 `feature/20260929-mongodb-deleted-operations`, 기준 `b401626aed20ca685d4d2c4d45074c94af7fbf67`.

## 이번 범위

deleted-operations GET/PUT를 기본PG adapter와 명시 deletedOperations context/Mongo 구현으로 연결했다. 기존 admin·JSON/문자열·응답 계약, exactID(empty/space/case포함), 8필드 목록·UTC날짜·삭제시각desc를 유지한다. 복원은deleted/live/replay 모두 삭제자/HMAC초기화·updatedAt갱신, 비관련raw/관계 보존. 실제논리복원만같은transaction감사. 일반수정/개별삭제/과정bulk/동시복원 경합 및한도/timeout/키/HMAC/감사실패를검증한다. 영구삭제·스키마·의존성·운영설정은 추가하지 않았다.

## 검증과 인계 위치

새PG17.9·45migration/Mongo8.0.30 replica set, Node24.19.0 env-i, 합성자료/임시키. runtime `/private/tmp/hub-om-deleted-operations-20260929`, PG56629/Mongo27729. 최종검증은 execution-review.md, 변경목록은 execution-manifest.md, feature/총괄SHA·자원정리는 integration-review.md를 따른다. 초기wrapper exit2와직접실행재검증은구별한다.

## 다음 개발 단위

기존 관리자 `onsite-required-backfill`과 `om-assignment-status-backfill`의 대상건수/적용 경계를 함께전환한다. 원본두route와panel 사용처읽기완료. onsite는active중Y아닌행, OM은active·배정필요·실제담당자값인행이며placeholder제외조건을유지한다. 실제보정실행없이 새합성DB에서같은PG/Mongo계약을비교한다. 기존로그의actoremail평문은감사기록과구분하여비노출처리를검토한다. 다음기준SHA는이번총괄통합후확정하며 별도feature브랜치/계획·검증으로진행한다.

운영기본PG·원본workspace·운영키/env/권한·실원천·배포/main/dev 유지. 자동화재개없음. 전체앱전환·실복사·복구리허설·최종전환·브라우저초안암호화는미완료다.

최종검사: 직접Node 신규40pass/0skip/0fail/exit0, broadMongo280pass/0skip/0fail/exit0(mock4포함), 일반889pass/36skip/0fail. typecheck/buildPASS, lint0error7기존warning. 초기wrapperexit2는실패기록으로유지, 위직접재검증과구별.

소유합성자원정리완료: Mongo getCmdLineOpts dbPath/replica이름 확인, 남은합성DB0, PG/Mongo정상종료와잠금/프로세스파일정리확인후소유dbpath2개제거. 경로부재와cleanup.log exit0확인. 로그/스크립트보존, 다른namespace/운영접근없음.
