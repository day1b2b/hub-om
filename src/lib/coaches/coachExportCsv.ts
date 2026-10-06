/** Quote CSV syntax and force spreadsheet formula-like cells to literal text. */
function escapeCsv(value: string): string {
  const literal = /^[=+\-@]/u.test(value.trimStart()) || /^[\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${literal.replaceAll('"', '""')}"`;
}
export function toCoachExportCsv(rows: Array<Record<string, string>>): string {
  if (!rows.length) return "\uFEFF";
  const headers = Object.keys(rows[0]);
  return `\uFEFF${[
    headers.map(escapeCsv).join(","),
    ...rows.map(row => headers.map(header => escapeCsv(row[header] ?? "")).join(","))
  ].join("\n")}`;
}
