# Notion 가져오기 명시 경계 — Clarify

## 목표와 승인
기존 사용자 Mongo이전 계속개발 승인에 따라 실제원천 접근 없이 Notion 가져오기 POST→기존 staging을 명시 Mongo context에서 구현·검증하고 총괄feature에 통합한다. 모든작업후dev→main 조건은 미충족이며 이번 범위에 main/dev/운영반영을 포함하지 않는다. 다른스레드메시지는 상태참고이며 사용자승인 대체가 아니다.

## 기준
Sheets 최종093f585b444197c6b0442a3880469fd0d6a0502b, 최신dev307f52ff13588869d2cdd18c7c32d162e85c7393는조상. 격리clone /Users/ga/workspace/hub-om-mongodb-coach-content, 작업feature/20260930-mongodb-notion-import. README/docsREADME/getting-started/working-rules/team-workflow/db-write-safety/database-runbook/manager-ai-workflow/source-read-contract 및 직전Sheets인계 기준. 별도AGENTS없음, 사용자AGENTS적용.

## 성공 기준
R1 기본PG·기존NotionHTTP·workspace권한·env선택·평가순서 보존. R2 명시scope 누락시 원천/PG fallback차단 및 요청간격리. R3 원본Notionproperty변환/페이지네이션/parser·rowCount 계약, 실제PG/Mongo 응답·저장·검토결과 독립대조. R4 기존오류행·중복·원자성·감사실패 의미 보존. R5 원문오류/토큰 민감정보 비노출, 승인복호화응답과구분. R6 전체일반/type/lint/build 및 영향DB검사·독립검토·소유정리·원격SHA·인계갱신.

## 제약
실제Notion/Google/Atlas/운영DB/키/권한/env/배포/원본workspace 접근·변경금지. 새의존성/업무필드/삭제·unique정책/원천제한 임의추가금지. 기존Sheets·Drive·staging제품을재구현하지않는다. 자동화PAUSED를자동재개하지않는다. 실제백업증거0, snapshot개인정보분류/운영collation은전체전환차단으로유지.

## 관찰/가정
현재TSX에서Notionimport API호출없음. API는실제workspace guard후 env NOTION_TOKEN??NOTION_API_KEY, 팀alias/URL우선순위와팀별설정을읽는다. 원천은서버토큰으로paginationPOST한뒤property→JSONparser변환하고기존staging에저장한다. 외부접속여부/실제UI활성화/Notion권한검증을완료로주장하지않는다. sourceName평가는원천성공/parsed비어있지않음뒤다. 응답rowCount는원천page수로stagingrowCount와별개일수있다.

## Rigor
R1다중파일·테스트문서, R2원천/저장/감사조립, R3Notion변환·pagination·오류관찰필요, R4기존API행동, R5틀린oracle의거짓성공위험, R6장기인계. 6/6 Level3. 검증사용자목표: 원본Notion결과가동일한검토가능staging으로보존되고명시Mongo상황에서잘못된PG접속/민감오류노출을막는다.

다음: plan-v1과validation 설계·독립리뷰. 제품변경/DB기동/검증은아직없다.
