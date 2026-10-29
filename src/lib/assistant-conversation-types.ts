export type AssistantConversationSession = { id: string; title: string; createdAt: string; updatedAt: string };
export const MAX_ASSISTANT_CONVERSATIONS = 20;
export function isAssistantConversationId(value: unknown): value is string {
  return typeof value === "string" && (value === "default" || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value));
}
