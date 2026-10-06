/** 같은 이메일이 이미 명단에 있을 때 createTeamUser가 던지는 오류. */
export class DuplicateTeamUserEmailError extends Error {
  readonly existingNames: string[];

  constructor(email: string, existingNames: string[]) {
    super(`이미 명단에 있는 이메일입니다: ${email}`);
    this.name = "DuplicateTeamUserEmailError";
    this.existingNames = existingNames;
  }
}
