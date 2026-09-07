/** 단일 선택에서는 쉼표도 이름의 일부이며, 다중 선택에서만 구분자로 쓴다. */
export function nameComboboxSegments(value: string, multiple: boolean): string[] {
  return multiple ? value.split(",") : [value];
}
