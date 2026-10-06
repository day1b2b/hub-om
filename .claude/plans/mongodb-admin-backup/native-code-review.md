**현재 native 구현의 정적 검토를 수락합니다. 확정적인 구현 차단 결함은 발견하지 못했습니다.**

검토 파일: [mongoAdminBackupRepository.ts](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoAdminBackupRepository.ts)

- **복합키·non-id 모델 — 112–132행:** 문자열 `_id`로 페이지를 진행하고 모델별 identity는 기존 codec으로 검증합니다. 복합키를 UUID로 잘못 제한하지 않으며, 빈 batch까지 읽어 짧은 batch로 인한 누락을 방지합니다.
- **metadata 6필드 — 134–158, 192–202행:** projection 후 선택 필드만 검증합니다. `errorMessage`·HMAC을 복호화하지 않고, 모든 상태·최근 20개·동률 비확정 계약을 유지합니다.
- **공개 필드 — 183–190행:** codec 결과에서 정책상 companion만 최상위에서 제거합니다. 사용자 JSON 내부 키를 재귀 삭제하지 않으며 JSON null sentinel도 처리합니다.
- **누적 예산 — 18–40, 161–178행:** 11개 전체 조회와 선택 metadata가 같은 행·BSON byte·시간 예산을 공유합니다. 페이지마다 전체/모델별 deadline을 재설정하지 않습니다.
- **정리·실패 — 128, 153, 174–178행:** cursor와 session을 finally에서 정리하고 borrowed client는 닫지 않습니다. 전체 작업을 cause 없는 고정 reject로 감싸 부분 결과를 반환하지 않습니다.
- **준비/open — 70–109행:** 기존 collection 검사를 선행하고 누락만 생성합니다. open은 읽기 검증이며 자동 수리하지 않습니다.

**실행 수락은 아직 아닙니다.** snapshot 동시 변경, 실제 CSOT·cleanup 실패, 누적 한도 경계 및 PG 전체 DTO 동등성은 별도 실행 증거가 필요합니다. 이번 검토는 현재 파일과 직접 의존 코드만 읽었으며 수정·테스트·DB 접속은 하지 않았습니다.
