# Mongo 공지·첨부 runtime 실행 리뷰

## 구현 결과

- 공지·첨부 repository와 요청 감사를 같은 borrowed Mongo client/database/namespace의 등록·잠금 scope로 조립했다.
- 새 빈 namespace만 audit→announcement 순서로 준비하고 기존·부분 namespace는 mutation 없이 전체 readiness만 확인한다.
- 등록 runtime 객체의 반쪽 재사용과 nested scope 전환을 callback 전에 차단한다.
- 기존 실제 API·페이지 통합 검증이 runtime을 통해 실행되도록 바꿨다.

## 실패와 보완

등록 runtime 적용 후 기존 반쪽 scope 검사의 기대 오류가 더 이른 `CALENDAR_SCOPE_MISMATCH`로 바뀌었다. 등록 객체 분해 차단과 미등록 반쪽 scope의 누락 포트 오류를 분리해 검증했다.

독립 리뷰에서 실제 준비 도중 중단된 namespace의 재실행 증거가 부족하다고 지적했다. request audit collection과 `CoachSchedulingGuard` 준비 후 첫 Announcement 생성에서 실패를 주입하고, 실제 존재 collection의 metadata/index/document snapshot을 기준으로 재실행의 고정 거부·mutation 0·불변성과 borrowed client 유지를 확인했다. 최종 재검토 결과 P0/P1/P2 차단 이슈는 없다.

## 검증

- 일반 회귀: 1,090 pass / 102 opt-in skip / 0 fail
- 실제 MongoDB 8.0.30: 13 pass / 0 skip / 0 fail
- typecheck/build: pass
- lint: 오류 0 / 기존 경고 7

운영 DB·Atlas·실제 외부 원천·운영 키·배포 설정에는 접근하거나 쓰지 않았다. 합성 replica set·DB·port는 종료 후 정리했다.

## 남은 범위

이 수락은 공지·첨부와 요청 감사의 명시 shadow 조립에 한정한다. production selector·전체 Next 요청·활성 작업·배포, 실제 데이터 이전·백업·복원·최종 전환은 완료되지 않았다.
