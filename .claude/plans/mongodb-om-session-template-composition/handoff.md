# OM 회차 템플릿 composition 인계

`OM_SESSION_TEMPLATE_BACKEND`의 기본값은 PostgreSQL이고, `mongodb-shadow`에서만 준비된 Mongo namespace의 request audit를 연다. 템플릿 생성은 저장소를 사용하지 않으며 기존 `mongoImportStagingRuntime`의 최소 template runtime을 재사용한다.

운영 설정과 템플릿 계약은 변경하지 않았다. 운영 데이터·외부 원천·Atlas에 접근하지 않았고 production 배포와 실제 shadow 복사·A/B 복원·최종 전환은 남아 있다. 통합 SHA는 최종 push 뒤 갱신한다.
