# Plan v2
핵심 난이도: 개인정보를 숨기는 것과 삭제 이후까지 재시도 이력을 보존하는 것을 하나의 저장 계약으로 결합한다.
1. [Core] 읽기 규칙: 파일 없음이면 빈 목록/빈 receipt, 기존 배열이면 operations로 간주; 객체는 operations 배열 필수, receipt 생략만 빈 맵으로 허용. receipt가 존재하나 모양/식별자 틀리면 오류. 암호문은 local:operations AAD로 해독하며 실패를 빈 데이터로 바꾸지 않는다.
수락: legacy 읽기 유지, 오염된 receipt·암호문은 읽기/쓰기 거부.
2. [Core] 쓰기 규칙: 전체 payload를 먼저 암호화하고 receipt를 보존한다. 같은 scope/body 재요청은 기존 행 반환, 다른 body 또는 삭제된 행은 conflict. 파일별 프로세스 직렬화. 0600 임시파일+rename으로 기존 파일이 평문/부분내용 상태가 되지 않게 한다.
수락: 생성/수정/삭제/재시작/동시 재시도 후 receipt 불변 및 파일 암호화. 실패 전 원본 bytes 불변.
3. [Shell] identity helper 및 타입 최소 필드만 이식; 실제 폼·API/DB 경로는 가져오지 않는다.
수락: 파일 범위 제한, 의존성/운영 데이터 변경 없음.
4. [Check] 독립 합성 fixture 회귀 테스트, lint/typecheck/test/build와 별도 읽기 전용 코드 검토.
수락: 관련 테스트 pass, 나머지 실패/skip은 정확히 기록하고 원인 대조.
대안: 기존 파일 직접 write는 간단하나 중간 읽기·실패 truncation 위험. temp+rename은 동일 디렉터리에 encrypted-only 임시파일을 쓰는 비용으로 이를 줄인다. 선택: temp+rename. OS crash fsync 및 여러 프로세스 쓰기는 미보장.

## Changelog
검증자 피드백 반영: receipt ID scope 검증, 삭제 tombstone 허용, 실패 시 temp 정리, rename 후 실패 가능한 부수 처리 제거, 기존0644→0600 및 여러 인스턴스 같은 경로 검증. 최종 Check에서 validation-v2의 V1–V8을 실행 결과와 대조한다.
