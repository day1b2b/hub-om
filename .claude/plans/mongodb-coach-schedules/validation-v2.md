# Validation v2
구조 S1: 각step Core/Shell/Check 명시, Core조건부규칙과행동수락기준존재. 구조실패면결과평가하지않음.
V1: actualhandler 빈월 기존log+고정시각 동시PUT이 두payload중정확히하나; empty경합도원자적. 다른월코치불변.
V2: 동일/부분중첩 날짜 동시예약의 모든성공응답 소유자=실제active단일승자. 중복입력dedup/재예약이력.
V3: 자기active만취소,타인불변/취소행과confirmedId보존. DELETE삭제coach200기존계약.
V4: selfGET accessedAt변경,PUT accessedAt보존,managerGET log불변,lastSaved fallback,engagements전체상태/slots확정상태+noncancelled만.
V5: 달력실재일/윤년/시간순서/null검증. 0000거부,0001–0099보정없이수락.
V6: 일정교체/예약/취소와ActivityChange 원자성,late감사실패/마지막accesslog실패 rollback. 예약name/email암호화HMAC. 허용감사필드변경값보존,PII redacted,AccessLog는공통감사제외. request감사는기존best-effort와구별.
V7: 무scope PG,존재scope서비스누락실패,직접Mongo변경감사context누락실패. index누락/기존active중복setup실패자동정리금지.
V8: nativeMongo8 actualhandlers + 전체tests/type/lint/build 실제실행. 독립코드리뷰P1/P2해소. 문서/manifest/alignment/handoff/featurepush.
증거: coachScheduleValidation.test.ts, prismaCoachScheduleRepository.test.ts(mock), mongoCoachScheduleRepository.integration.test.ts(native). 실제명령과카운트는manifest에기록한다. OAuth/UI/실PG/운영DB는미검증및생산전환별도게이트.
