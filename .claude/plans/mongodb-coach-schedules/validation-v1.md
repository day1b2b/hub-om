# Validation v1 — independent critic sql_review
구조: Core/조건부규칙/수락기준 존재 통과. 계획 보완 조건부 수락.
V1 기존log 빈월 서로다른 PUT, 빈배열경합, 고정시각에도 최종 한배열이어야하며 합집합은실패. 다른월코치격리.
V2 동일날짜/부분중첩 여러예약응답의 소유자가 실제단일승자와일치. 중복입력,재예약포함.
V3 자기 active 예약만취소, confirmed링크/기취소이력보존. DELETE에coach404추가금지.
V4 self GET accessedAt만갱신/PUT기존값유지/lastSavedAt fallback/engagement전체상태 vs schedule상태제한.
V5 실제달력/윤년/년00–99/null/시간역전거부.
V6 업무+변경감사transaction rollback/PII암호문HMAC/DTOcompanion금지.
V7 누락scope failclosed/기존중복setup거부/nullvalidator일치.
보완: no-op log업데이트는월직렬화를증명못함. lastEditedAt단조증가로실제쓰기보장. 범위밖 engagement/sync 확정writer와원자성은생산전환차단게이트. Coach삭제와예약경합은기존수준이며직렬화보장추가없음. softdelete와cascade는별개;확정예약이력은마이페이지기능.
