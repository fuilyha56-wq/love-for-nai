export type ReferralAccountStatus = "active" | "disabled" | "unknown";

/** NewAPI disables with 2; local authentication disables with 0. */
export function referralAccountStatus(
  value: unknown,
  provider: "local" | "newapi",
): ReferralAccountStatus {
  if (value == null || value === "") return "unknown";
  if (Number(value) === 1) return "active";
  if (Number(value) === (provider === "local" ? 0 : 2)) return "disabled";
  return "unknown";
}

export function referralAccountStatusText(
  status?: ReferralAccountStatus,
): string {
  return status === "active"
    ? "正常"
    : status === "disabled"
      ? "已禁用"
      : "状态未知";
}
