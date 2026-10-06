# 토큰 backfill 계획 v1

기준 1a7323bf81108e1a7fe16196cba5b7a3c60c80a7. 기존 개발 승인 내 다음 기능단위. development-harness R1/R2/R4/R5/R6=5, Level3 validated-plan 적용. 운영 적용·새 스키마·의존성·삭제정책 없음.

1. 기존 backfillCoachAccessTokens(db, options) PG API·CLI 인자·기본dry-run 유지. interface/factory/명시 context와 실행 service를 더해 기존 CLI도 PG 기본 repository로 연결한다. 직접 주입 PG API는 호환 유지. 명시scope누락은 fallback 금지.
2. Mongo backfill(options)는 명시 shadow write gate, 준비된 Coach/CoachdbArchiveRow/CoachdbArchiveSnapshot/ActivityChange 4모델, replica/snapshot transaction, 120초 전체 한도. 명시 prepare만 DDL. dry-run은 write/감사/guard 생성 없음. maintenance는 실행자의 사전조건이며 자동 운영확인 아님.
3. 코치 id asc 250 이하 paging, archive public/coaches·rowKey HMAC+복호화원문 확인·completed snapshot만·startedAt desc 후 archive row id desc. 최신 non-null 문자열(빈문자열포함) 선택, null/scalar/array rowData 무시, 필요한 nonstring token은 원문없는 실패. 삭제/비활성 coach도 기존대로 포함. 토큰 map은 코치page내로 제한, 대량 전체복호화 수집 금지.
4. apply는 실제달라진 token만 암호화/HMAC 갱신·updatedAt, 기존 activity context 있으면 redacted audit, context없으면 기존 CLI처럼 audit없음. 중복/HMAC/키/오류/timeout은 전체rollback. snapshot 충돌의 기존 driver bounded retry만 허용하며 정상 재실행은updated0. 생산maintenance 전제 유지; 실시간 전체archive writer직렬화로 과장하지않음.
5. 양backend 고정fixture 실제PG45migration/Mongo 비교, >250코치/archive 및 BSON짧은batch, 최신null/동률/완료상태/공백·대소문자/변조/후행실패·중복rollback/재시도/읽기불변/로그비노출 검증. CLI 실제service 및 context/missing/noPG 검증.
6. 전체일반/type/lint/build·영향Mongo회귀·독립리뷰. 문서/coverage/macro·featurecommit/push/SHA·소유synthetic정리 후 총괄통합. 코드동일시 불필요반복검사 없음. 운영이전/dev→main은별도.

대안: 모든 archive를 메모리에 읽어정렬하면간단하나 기존bounded토큰노출계약위반. DB에서 정렬하고 제한된 batch를 읽으며 cursor CSOT/getMore 문제와 BSON짧은batch를 검증한다. 기존 PG maintenance계약을 보존하며 불필요한 새잠금정책을 추가하지 않는다.
