# 코치 토큰 보완 CLI composition 인계

기존 Mongo repository를 실제 CLI의 exact selector에 연결한다. 기본은 PostgreSQL이며 Mongo는 준비된 shadow만 연다. 실제 운영 토큰 보완, 백업·maintenance 확인, 운영 이전은 수행하지 않았다.

합성 Mongo CLI 4건과 전체 회귀 1543건(1368 pass·175 skip·0 fail), typecheck·build, lint 오류 0·기존 경고 7을 확인했다. 실제 운영 backfill에는 기존 확인 플래그 외에도 검증된 백업·복원과 쓰기 중단이 필요하다.
