# 외부 원천 읽기 계약

이 문서는 외부 원천을 읽어 hub-om의 표준 운영 데이터로 연결하기 위한 공개 가능한 계약만 정리합니다.
실제 원천 파일명, API 인증값, 고객사/담당자/강사명, 링크, 금액 예시는 공개 저장소에 커밋하지 않습니다.

## 범위

MVP에서는 외부 원천에 쓰지 않고 읽기만 합니다.

- 강의 캘린더/운영 보드: 과정명, 담당자, 시작일, 종료일, 상태 참고값.
- Google Calendar: OM별 강의 일정, 부재 일정, 주변 일정.
- Slack: 과정명/기업명 기준으로 참고할 수 있는 논의 링크.
- Salesmap: 코스ID, 기업, 과정, 매출 참고값.

## 공개 저장소에 두는 것

- `src/lib/sourceReads/sourceReadTypes.ts`의 읽기 결과 타입.
- 연동이 설정되지 않았을 때 빈 결과를 반환하는 기본 reader.
- `OPERATION_SOURCE_READER_MODULE`로 비공개 reader 모듈을 연결하는 hook.
- 외부 원천 결과를 표준 운영 데이터로 매핑할 때 지켜야 할 규칙.

## 공개 저장소에 두지 않는 것

- 실제 API 토큰, OAuth secret, webhook URL.
- 실제 워크스페이스/데이터베이스/스프레드시트/캘린더 식별자.
- 실제 고객사명, 담당자명, 강사명, 비용/매출, 링크.
- 실제 원천 행 예시와 원천 분석 문서.

## 원천별 읽기 결과

외부 reader는 아래 메서드를 구현합니다.

- `readCourseBoard()`: 강의 캘린더/운영 보드에서 과정 단위 참고 정보를 읽습니다.
- `readCalendarEvents()`: OM별 강의 일정, 부재 일정, 주변 일정 판단에 필요한 이벤트를 읽습니다.
- `readDiscussionReferences()`: 과정 상세에서 보여줄 논의 링크를 읽습니다.
- `readSalesRecords()`: 코스ID/기업/과정/매출 참고값을 읽습니다.

모든 메서드는 `SourceReadResult<T>`를 반환합니다.

- `status`: `disabled`, `ok`, `partial`, `failed`.
- `readAt`: 읽기 시각.
- `items`: 정규화된 읽기 결과.
- `issues`: 누락, 권한, 매핑 실패처럼 사람이 확인해야 할 문제.

## 비공개 reader 연결 방식

비공개 런타임 패키지나 보안 작업 공간의 모듈은 `createOperationSourceReader()`를 export합니다.

```ts
export function createOperationSourceReader() {
  return {
    readCourseBoard,
    readCalendarEvents,
    readDiscussionReferences,
    readSalesRecords
  };
}
```

배포 환경에서는 `OPERATION_SOURCE_READER_MODULE`에 해당 모듈명을 설정합니다. 설정하지 않으면 기본 disabled reader가 빈 결과를 반환합니다.

## 매핑 규칙

- 화면 컴포넌트는 외부 원천 타입을 직접 사용하지 않습니다.
- 외부 reader 결과는 repository/adapter 레이어에서 `OperationSession` 또는 DB staging 구조로 매핑합니다.
- 매핑 실패 데이터는 버리지 않고 `issues` 또는 `validationErrors`로 남깁니다.
- 자동으로 확정할 수 없는 고객사명, 담당자명, 과정명은 검토 대상으로 둡니다.
- 실제 운영 DB에 쓰기 전에는 import run, source record, validation 결과를 먼저 확인합니다.

## 완료 기준

읽기 연동을 완료했다고 보기 위한 최소 기준은 아래와 같습니다.

- 연동이 꺼진 환경에서 앱이 깨지지 않고 빈 결과를 반환합니다.
- 원천별 읽기 실패가 앱 전체 장애로 번지지 않고 `issues`로 남습니다.
- `/api/source-reads/status`에서 원천별 읽기 상태와 개수만 확인할 수 있습니다.
- 실제 원천 값이 화면 컴포넌트에 직접 새지 않습니다.
- 공개 저장소에 민감 정보나 실제 데이터 예시가 남지 않습니다.
