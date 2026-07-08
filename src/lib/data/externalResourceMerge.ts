import type { OperationSession, SourceTeam } from "@/lib/data/operationTypes";

export function mergeExternalResourceOperations(
  operations: OperationSession[],
  externalOperations: OperationSession[]
) {
  if (externalOperations.length === 0) {
    return operations;
  }

  const externalTeams = new Set(
    externalOperations
      .map((operation) => operation.sourceTeam)
      .filter((team): team is SourceTeam => Boolean(team))
  );

  return [
    ...operations.filter((operation) => !operation.sourceTeam || !externalTeams.has(operation.sourceTeam)),
    ...externalOperations
  ];
}
