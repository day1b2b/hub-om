# 관리자 DB 전환 범위

사용자 계속 진행 승인에 따라 관리자 DB dashboard8표 조회와 기존4표 셀 편집의 Mongo 경계를 구현·합성검증·독립리뷰·featurepush·총괄통합한다. 기준4db4cf685f5632ecb1156c57b1a6992502c0589c, 원격일치/clean. 최신dev307f52f읽기확인, 총괄기준진행은기존승인이다.

기존PG기본/화면·권한·allowlist·파싱·응답·감사를유지한다. 실제운영수정/배포/main/dev병합금지, 원본workspace수정금지. 새dependency/업무schema/삭제정책없음. 명시내부context에서만Mongo, fallback없음. 조회응답의인가된복호화값과저장/로그평문금지를구분한다.

대시보드 8표: Company,Course,OperationSession,Member,DataImportRun,OperationSourceRecord,DriveImportRun,DriveImportResult. 기존표별count·sample100·sort·관계존재·JSON요약·latestActivity·rawValue와deleted포함보존. 셀은기존ADMIN_EDITABLE_FIELDS의4표만, name정규화/PIIcompanion/unique·updatedBy/감사규칙보존.

R1/R2/R3/R4/R5/R6=6, Level3. 핵심위험: Decimal/nullable/schema위반차이, HMACunique, 기존writer의부분갱신경합,8표표시동등성. 질문할업무결정없음. 미정구현선택은원본코드/실PGoracle로판단한다.
