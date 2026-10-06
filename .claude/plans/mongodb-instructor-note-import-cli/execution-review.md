# 강사노트 파일 가져오기 CLI 실행 리뷰

암호화 스키마에서 실행을 거부하던 legacy raw pg CLI를 repository command로 교체했다. 기본 encrypted PostgreSQL과 exact Mongo shadow 선택, 암호화 source JSON 복호화·PII 제거, Notion NO 우선/구형 이름 key 병합, COALESCE/OR 의미, apply 확인 gate와 전체 transaction을 구현했다. Mongo 강사노트 writer는 신규 생성 가능성이 있을 때만 같은 namespace guard를 사용하고 재조회해 최초 생성 경합을 한 행으로 수렴시킨다. 읽기 전용 dry-run은 guard를 갱신하지 않는다. dry-run과 오류 출력에서 이름·메모·경로·내부 오류를 제거했다.

일반 회귀 1,129 pass/118 opt-in skip/0 fail, 실제 MongoDB 8.0.30 가져오기 root 1 pass와 기존 Notion 동기화 25 pass, 실제 합성 PostgreSQL 17 root 1 pass, focused 4 pass, typecheck/build 통과, lint 오류 0·기존 경고 7이다. 독립 리뷰가 찾은 암호화 원천, 숫자 key/Notion NO, 동시 최초 생성, dry-run guard 쓰기와 주석 불일치를 보완해 재검증했다. 최종 재검토는 잔여 P0~P3 없이 통과했다. 운영 데이터·실제 원천·키·설정은 검증하지 않았다.
