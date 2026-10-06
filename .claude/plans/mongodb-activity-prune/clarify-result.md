# 활동 로그 정리 범위

기준b333931a2e7d281b697baf20a75bdf13b8e2b094, feature/20260930-mongodb-activity-prune. 활성 npm activity:prune의 PG 직접호출을 명시 저장소 경계로 분리하고, 기존30일/365일·모델별1000·두삭제배치원자성·누적합계·정리종료를보존한다. 전체drain이아닌배치단위원자성이다.

운영데이터/실env/키/스케줄러/배포/main/dev/원본workspace변경없음. 새보존/삭제정책·업무필드·의존성없음. 실제운영CLI를실행하지않고새loopbackPG/Mongo·합성로그·임시키만사용한다. root /private/tmp/hub-om-activity-prune-20260930, ports56758/27858 예정. 이전backup 자원정리·원격b333931완료. 사용자개발·검증·총괄통합승인유효, 실제열린결정없음.

R1/R2/R4/R5/R6 적용5/6 Level3, 기존하네스/validated-plan 지속. 기존MongoRequestAuditRepository의자동정리는클라이언트시간·순차삭제라PG원자성과다르다. 이번CLI는새2모델repository로원자성을보존하며자동정리기존차이는함께검토해공유원자적helper로연결해함께종결한다. 운영정기스케줄설치여부는확인되지않았다.
