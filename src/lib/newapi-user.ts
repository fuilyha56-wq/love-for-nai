export type NewApiIdentity = {
  id: number;
  username: string;
  display_name?: string;
};

export function newApiIdentity(data: unknown): NewApiIdentity | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const candidate = record.user ?? record;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const user = candidate as Record<string, unknown>;
  const id = typeof user.id === "number" ? user.id
    : typeof user.id === "string" && /^[1-9]\d*$/.test(user.id) ? Number(user.id) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0 || typeof user.username !== "string" || !user.username.trim()) return null;
  return {
    id,
    username: user.username,
    ...(typeof user.display_name === "string" ? { display_name: user.display_name } : {}),
  };
}
