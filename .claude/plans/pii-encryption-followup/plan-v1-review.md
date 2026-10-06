# 초기 계획 검토 기록

Core는 존재하나 후보 추출 NOT/OR 의미와 정렬 메모리 비용을 구체화할 필요가 있었다. 독립 읽기 검토 결과에 따라 임계값 증가/무제한 scan/새 토큰인덱스 대신 기존 업무조건 후보 축소를 채택했다. 정렬 키 projection은 root RepeatableRead에서만 적용하고 callback transaction은 기존 경로를 유지한다. 상세 실행 반례와 보완은 execution-review.md.
