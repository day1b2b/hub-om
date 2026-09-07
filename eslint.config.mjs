import { fixupConfigRules } from "@eslint/compat";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// 일부 Next 플러그인은 ESLint 10에서 제거된 context API를 아직 사용한다.
// 공식 어댑터로 API를 연결하고 기존 규칙과 검사 범위는 유지한다.
const eslintConfig = fixupConfigRules([...nextCoreWebVitals, ...nextTypescript]);

export default eslintConfig;
