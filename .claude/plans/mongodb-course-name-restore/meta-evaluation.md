# 메타 검토 — Gibbs

계획 적합. critic4보완 반영이면 추가차단없음. 매retry에서guard→plan→처음제출hash순서, firstupsert도총30s포함. 관련변경은원본readPlan projection(Course필드·active session·latest2source)범위로한정. 옛source/삭제행모든필드stale불요. singleton은복원직렬화만, 무관courseId계획을stale처리안함(guard는hash제외). 실행수락별도.
