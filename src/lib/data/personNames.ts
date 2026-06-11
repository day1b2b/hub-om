const PERSON_NAME_DELIMITER = /[,，、/]+/;

export function splitPersonNames(value: null | string | undefined, fallback = "배정필요") {
  const names = (value ?? "")
    .split(PERSON_NAME_DELIMITER)
    .map((name) => name.trim())
    .filter(Boolean);

  return names.length > 0 ? unique(names) : [fallback];
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
