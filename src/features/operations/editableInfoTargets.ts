export function resolveEditableInfoTargets(operationId: string, operationIds?: readonly string[]): string[] {
  if (!operationIds?.length) return [operationId];

  const targets = [...new Set(operationIds.filter(Boolean))];
  return targets.length > 0 ? targets : [operationId];
}
