/** Cents under a dollar, so a quiet month does not read as $0.00 (EPIC-14 S10 Usage section). */
export function usd(value: number): string {
  if (value > 0 && value < 0.995) return `${Math.max(1, Math.round(value * 100))}¢`
  return `$${value.toFixed(2)}`
}
