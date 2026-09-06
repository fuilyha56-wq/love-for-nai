export function balancePreview(balance: number | null | undefined, cost: number) {
  if (balance == null || !Number.isFinite(balance) || !Number.isFinite(cost)) return null;
  const available = Math.max(0, balance);
  const required = Math.max(0, cost);
  const remaining = Math.max(0, available - required);
  return {
    available,
    required,
    remaining,
    percent: available > 0 ? (remaining / available) * 100 : 0,
    insufficient: required > available,
  };
}
