**scope P2 보완 수락·종결합니다.**

- 실제 scan/search 진입을 직접 계수하며, HTTP 없는 import 중 호출도 동일 `source0` 단언이 거부하는 음성대조를 확인했습니다.
- `scope-fixed.log`: **11 PASS / 0 fail / 0 skip**. `pg-gate-fixed.log`: **1 PASS / 0 fail / 0 skip** 확인.
- native 제품 SHA-256은 `source-native-before.sha256`과 일치합니다(`09295f7c…370b4e`). V3 실행 PASS 자체는 이번에 독립 확인하지 않았습니다.

수정·DB·테스트 실행 없이 검토했습니다. 전체 수락은 후속 실행 증거까지 보류합니다.
