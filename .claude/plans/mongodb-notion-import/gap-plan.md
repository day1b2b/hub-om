# 검증 공백 보완 계획 및 결과

범위는 제품 변경 없이 검증의 거짓 성공/실패를 막는 세 항목이다. 원인과 독립 판정은 gap-review.md에 보존했다.

1. [Core] 기존 공개 업무 sentinel과 개인정보 canary의 의미를 분리한다. 운영 정책은 유지하고 동일 raw 불변·전체 문자열 검사를 통과해야 한다.
2. [Core] HTTP 예상 밖 호출/옵션 위반은 route의 generic400과 별개로 보존하여 POST 외부에서 거부한다. 같은 검사기에 오류를 주입하여 잡히는지 확인한다.
3. [Core] 응답에서 검증된 ID를 누적해 마지막 recovery 이후 전체 run/source/audit와 양방향 대조한다. 추가 audit/orphan row/동일 개수 ID 교체를 같은 검사기가 거부해야 한다.
4. [Check] 소유자가 파일을 확정한 뒤 부모가 handler·parity를 재실행하고 타입/lint를 확인한다. 변경 없는 제품의 build/HTTP/native 일반 검사를 무조건 반복하지 않는다.
5. [Check] 원 지적자 Carver·Parfit의 독립 재수락 후 최종 증거와 정리·인계에 반영한다.

실행 결과: handler15/최종parity root1(각47ledger) PASS·skip0·exit0, type/lint exit0. 원 지적자의 실행 재수락 완료. 검증 상세는 execution-review.md. 제품3파일 hash 불변, 새 업무 정책·스키마·운영 쓰기0.
