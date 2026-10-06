# 공통 개요 화면 composition 실행 검토

- 범위: 대시보드·내 업무·회사 위키·리소스 화면의 서버 조회
- 기본 PostgreSQL, 정확한 `mongodb-shadow`만 준비된 runtime open
- operations·teamMembers·teamUsers·omRequests를 같은 잠금 scope에서 사용
- 부분 namespace 자동 수리 금지, redirect·404와 외부 source 경계 보존
- 운영 데이터·배포 설정·브라우저 전체 흐름·최종 전환 제외
