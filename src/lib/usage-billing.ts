export type UsageLog = Record<string, unknown>;
export type UsagePayment =
  "personal" | "package" | "mixed" | "newapi" | "unknown";

export function usagePayment(item: UsageLog): UsagePayment {
  const raw = item.payment_source;
  return ["personal", "package", "mixed", "newapi"].includes(String(raw))
    ? (raw as UsagePayment)
    : "unknown";
}
export function paymentMatches(item: UsageLog, selected: string): boolean {
  const source = usagePayment(item);
  if (!selected) return true;
  if (selected === "aff") return source === "personal" || source === "mixed";
  if (selected === "package") return source === "package" || source === "mixed";
  return source === selected;
}
export function paymentLabel(item: UsageLog): string {
  return {
    personal: "个人 AFF",
    package: "图包",
    mixed: "AFF + 图包",
    newapi: "NewAPI 余额",
    unknown: "未记录付款来源",
  }[usagePayment(item)];
}
export function usageOrigin(item: UsageLog): string {
  let other: Record<string, unknown> = {};
  try {
    other = typeof item.other === "string" ? JSON.parse(item.other) : {};
  } catch {
    /* Optional historical metadata. */
  }
  const raw = String(
    item.provider ||
      item.provider_id ||
      item.providerId ||
      other?.providerId ||
      other?.request_path ||
      "newapi",
  ).toLowerCase();
  if (raw.includes("lfn")) return "lfn";
  if (raw.includes("api")) return "newapi";
  if (raw.includes("novelai") || raw.includes("nai")) return "novelai";
  return raw || "other";
}
export function usageCost(item: UsageLog): string {
  const local = ["personal", "package", "mixed"].includes(usagePayment(item));
  const value = local
    ? item.charged_aff
    : (item.quota ?? item.cost ?? item.amount);
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return local
    ? `${Number(Number(value).toFixed(4))} AFF`
    : `$${(Number(value) / 500000).toFixed(2)}`;
}
