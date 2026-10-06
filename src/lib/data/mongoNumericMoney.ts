/** Round the Number's decimal wire representation to numeric(14,2), including
 * exponent notation and negative half ties. Never multiply a floating value by 100.
 */
export function numericMoney(value: number, failure: (code: "INVALID_DECIMAL" | "DECIMAL_OVERFLOW") => Error = code => new Error(code)): string {
  if (!Number.isFinite(value)) throw failure("INVALID_DECIMAL");
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw failure("INVALID_DECIMAL");
  const fraction = match[3] ?? "";
  const digits = BigInt(match[2] + fraction);
  const shift = Number(match[4] ?? 0) - fraction.length + 2;
  let cents: bigint;
  if (shift >= 0) cents = digits * 10n ** BigInt(shift);
  else {
    const divisor = 10n ** BigInt(-shift);
    cents = digits / divisor + (digits % divisor * 2n >= divisor ? 1n : 0n);
  }
  if (cents >= 100_000_000_000_000n) throw failure("DECIMAL_OVERFLOW");
  return `${match[1] && cents !== 0n ? "-" : ""}${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
