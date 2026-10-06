# 실행 중 발견과 보완
1. 파일조회 일부 추측경로 없음→rg로 실제파일확인. cloneAGENTS없음→사용자/상위지침적용. 실행상태변경없음.
2. 에이전트 메시지 UUID오타1회전송실패→올바른ID로재전송. 메시지유실/중복작업없음.
3. 제품typecheck통과후native새test의Mongoevent unknown/union callback 추론오류→정확한Document 및unknown generic 주석만수정. runtime native12pass와별도로최종typecheck필수.
4. 독립계획검토의첫unit범위분리 반영,배정후속필수. 실제PG동일JSON의감사를따르도록명시written sessions 강제redacted변경지원(검증중).
5. 중간독립리뷰 P2둘: 옛export syncAssignedOmToLinkedOperation도 명시scope차단 추가(생산PG동작유지); 암호화JSON null legacyrow는MongoJsonNull→DTO sessions[] 보정. 실제nativecase추가,oracle에도요청.
6. 새실factory단위test가기존NotionTeamMemberRepository의parameter property를Node24strip-only에서로드불가(0pass1fail). 같은속성명시할당으로동작없이문법만수정;원천호출정책변경없음.
7. 두test초안통합전발견: handlerfixture닫는괄호누락/fixture patch기존HMAC companion재사용→괄호및completeMongoRow로fixture수정. PG첫대조는rawpg timestamp withouttimezone를호스트KST로파싱해9시간차이(원본과새PG동일실패)→테스트프로세스TZ UTC고정. 제품동작이나비교값정규화완화아님.
8. 실제원본PG가fractional Int입력거부라는test초안가정틀림: 1.5→1,-1.9→-1,0.1→0,Int32경계내trunc확인. 격리원본probe숫자12개create/update;NaN/Infinity/Int32초과거부. Mongoinput에finite Math.trunc 적용,양/음/경계5개원본대조추가. 제품동작보존필수fix이며회차수정책변경없음. numeric-probe.log 증거.

9. 최종 독립리뷰 V12 검증 누락: 회차 전부 생성 후 결과보고서 patch 첫/둘째 실패의 직접 실행 근거 없음. 실제 OperationSession validator로 두 위치의 NOT_REQUIRED 쓰기를 거부, 실제 POST 201/두 회차 유지/이미 성공한 patch 유지/대표 연결 없음/후속 도구·알림·LD메타/실패 update 감사 없음 확인. v12-handlers.log 19pass0fail, v12-typecheck.log 통과. 제품변경 없음, 테스트 한 파일만 추가.
