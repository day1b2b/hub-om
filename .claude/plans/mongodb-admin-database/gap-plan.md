# 독립 리뷰 검증 공백 보완

V3: 기존 NULLS LAST의 100행 경계와 OperationSession BSON-short 검사는 있으나 Member 복합 keyset의 여러 batch 구간 통과 검사가 빠졌다. 실제 서버의 batchSize만 1/3으로 제한해 active·inactive/nonnull·null/동률 날짜·ID 구간 8행을 정확히 대조한다. 응답·쿼리 결과를 모킹하지 않는다. native 검사·타입/린트 및 독립 재검토로 닫는다. 제품 코드는 변경하지 않는다.
