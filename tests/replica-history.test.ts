import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReplicaHistory, type ReplicaHistoryItem } from "@/app/image/replica-history";

// Keep the card's menu open while inspecting its event handlers. No browser or
// clipboard work is required to verify that each entry routes the original item.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useEffect: () => {},
    useId: () => "history-menu-test",
    useRef: () => ({ current: null }),
    useState: (initial: unknown) => [typeof initial === "boolean" ? true : initial, vi.fn()],
  };
});

type TestProps = { children?: ReactNode; role?: string; onClick?: () => void };
type TestElement = ReactElement<TestProps>;

function descendants(node: ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!isValidElement<TestProps>(node)) return [];
  return [node, ...descendants(node.props.children)];
}

describe("本次历史操作入口", () => {
  const item: ReplicaHistoryItem = {
    image: "/history-original.png", prompt: "1girl", negative: "blurry",
    width: 832, height: 1216, operation: "generate", createdAt: 123,
    steps: 28, scale: 5, sampler: "k_euler_ancestral", seed: 42,
  };

  it.each([
    ["复用参数", "reuse-parameters"],
    ["用于图生图", "img2img"],
    ["用于局部重绘", "inpainting"],
    ["用于导演工具", "director-lineart"],
    ["用于风格迁移", "vibe-transfer"],
    ["用于超分", "upscale"],
  ])("%s 将原历史记录交给对应操作", (label, operation) => {
    const onUse = vi.fn();
    const history = ReplicaHistory({ items: [item], onOpen: vi.fn(), onUse, onDelete: vi.fn() });
    const card = descendants(history).find((element) => typeof element.type === "function");
    expect(card).toBeDefined();
    const renderCard = card!.type as (props: unknown) => ReactNode;
    const entries = descendants(renderCard(card!.props)).filter((element) => element.props.role === "menuitem");
    const entry = entries.find((element) => element.props.children === label);
    expect(entry).toBeDefined();
    expect(onUse).not.toHaveBeenCalled();
    entry!.props.onClick!();
    expect(onUse).toHaveBeenCalledExactlyOnceWith(item, operation);
  });

  it("在参数详情中显示当前历史记录的图像模型", () => {
    const withModel: ReplicaHistoryItem = { ...item, model: "gpt-image-1.5", providerId: "personal-provider", imageProtocol: "openai-images", quality: "high", imageSize: "1K", background: "transparent" };
    const history = ReplicaHistory({ items: [withModel], onOpen: vi.fn(), onUse: vi.fn(), onDelete: vi.fn() });
    const card = descendants(history).find((element) => typeof element.type === "function");
    const renderCard = card!.type as (props: unknown) => ReactNode;
    const details = descendants(renderCard(card!.props)).find((element) => element.type === "details");
    expect(details).toBeDefined();
    expect(descendants(details).find((element) => element.type === "summary")?.props.children).toBe("参数详情");
    expect(descendants(details).find((element) => element.type === "dt")?.props.children).toBe("模型");
    expect(descendants(details).find((element) => element.type === "dd")?.props.children).toBe("gpt-image-1.5");
  });

  it("没有模型字段的旧历史记录不显示空参数详情", () => {
    const history = ReplicaHistory({ items: [item], onOpen: vi.fn(), onUse: vi.fn(), onDelete: vi.fn() });
    const card = descendants(history).find((element) => typeof element.type === "function");
    const renderCard = card!.type as (props: unknown) => ReactNode;
    expect(descendants(renderCard(card!.props)).some((element) => element.type === "details")).toBe(false);
  });
});
