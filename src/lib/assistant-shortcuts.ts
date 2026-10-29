export type AssistantShortcut = { command: string; aliases: string[]; title: string; input?: string; action?: "sessions" | "new" | "image" };
export const ASSISTANT_SHORTCUTS: AssistantShortcut[] = [
  { command: "/prompt", aliases: ["/整理"], title: "整理当前提示词", input: "请整理当前提示词，保留主体、权重和画面意图，优化描述与结构。" },
  { command: "/tags", aliases: ["/标签"], title: "查询并解释标签", input: "请为当前画面检索合适的标签，核验词条并解释含义与来源。" },
  { command: "/negative", aliases: ["/反向"], title: "整理负向提示词", input: "请结合当前画面目标整理合适的负向提示词，并说明取舍。" },
  { command: "/characters", aliases: ["/角色"], title: "整理角色设定与位置", input: "请整理各角色独立的外貌、服装与画面位置，并保持角色特征一致。" },
  { command: "/sessions", aliases: ["/会话"], title: "打开会话管理", action: "sessions" },
  { command: "/new", aliases: ["/新建"], title: "创建新会话", action: "new" },
  { command: "/image", aliases: ["/参考"], title: "添加参考图片", action: "image" },
];

export function assistantShortcuts(input: string): AssistantShortcut[] {
  const query = input.trim().toLocaleLowerCase();
  if (!query.startsWith("/") || query.length > 32 || /\s/.test(query)) return [];
  return ASSISTANT_SHORTCUTS.filter((item) => [item.command, ...item.aliases].some((command) => command.startsWith(query)));
}
