# Plan v2

핵심 난이도는 이름·ID·개인 식별의 우선순위와 기존 행의 빈값 보충 의미를 concurrent writer에서도 보존하고, 실패 행만 되돌리는 것이다.

1. [Core] 실제 분기를 그대로 단일 workflow에 옮긴다. notionNo 우선, 이름 후보는 createdAt asc이며 입력 notionNo 있으면 unkeyed만·없으면 keyed도 포함, 마지막은 같은 정규화 이름+phone OR birthDate. deleted 필터 추가/복구 금지, 새 동명이인 우선순위 금지. 일반 truthy public/private overwrite/name 불변, duplicate만 빈값 보충/notionNo 불변, 기존 employeeId는 null이어도 유지. nonempty 태그만 교체, duplicate 기존 관계 있으면 유지.
2. [Core] 각 source 행의 transaction 시작 catalog→대상 coach 정렬 잠금→재매칭·최신 값→첫 쓰기. 코치/profile/master/link/ActivityChange 함께 commit. 실패하면 그 행만 rollback하고 다음 행 계속, 결과 카운트는 callback 밖. fetch는 잠금 밖 고정 snapshot. 전체 작업 atomic화는 기존 부분 성공 정책 변경이므로 제외.
3. [Core] normalizedName HMAC equality와 원문 검증으로 후보 제한, profile/link/master batch 조회. 생일은 별도 HMAC가 없으므로 복호화 Date 비교. 전화 임의 정규화 금지. raw driver/source 오류는 고정 코드만 응답/errorDetail/log에 전달.
4. [Shell] repo/source/context/PG기본 factory, actual Notion/all caller에 연결. all은 필요한 모든 repo/source를 외부 읽기 전에 확인하고 Notion→계약→일정 순서를 유지. 기존 runlog lifecycle과 auth 유지. dryRun은 업무/guard/runlog 쓰기0.
5. [Check] Node24 env-i/소유 Mongo8.0.30: identity/deleted/OR/순서, 일반 vs duplicate, tags/master경쟁, 감사/후반 실패, 행실패계속·all단계commit·retry·auth·scope·오류 비노출·암호화·dryrun 실제handler 검증. 전체 test/type/lint/build와 독립 리뷰.
6. [Shell] coverage/macro/artifacts 갱신, 남은 전체 암호화 blocker와 운영 리허설/전환 분리 기록. feature commit/push SHA 확인, 임시 DB/프로세스 정리.
