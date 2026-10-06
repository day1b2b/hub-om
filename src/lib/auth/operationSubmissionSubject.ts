/** Resume-account consistency only. Call after workspace authentication; this header grants no access. */
export function operationSubmissionSubjectConflict(
  request: Request,
  session: { browserDraftSubject?: string }
): Response | null {
  const expected = request.headers.get("X-Operation-Submission-Subject");
  if (expected === null) return null;
  if (!session.browserDraftSubject || expected !== session.browserDraftSubject) {
    return Response.json({
      ok: false,
      error: "로그인 계정이 변경되었습니다. 원래 계정으로 로그인한 뒤 등록을 재개해주세요."
    }, { status: 409 });
  }
  return null;
}
