# 삭제 운영 목록·복원 실행 계획 v2

plan-v1 Core1–3 및검증·인계단계를유지한다. 수락기준은 validation-v2 V1–V10.

v1대비보완: malformedJSON400/JSONnull예외, empty/space/case실존ID대조. actualwriteconflict재시도와bulk대상제외/active조건실패를구별. updatedAt간격후재복원검증과감사제외·raw보존은그대로다. 역할분담유지. 마지막단계는필수검사·독립리뷰·한계기록·소유자원정리·원격SHA/총괄feature통합이다. 운영/dev/main 미변경.
