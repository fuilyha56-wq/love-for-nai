import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSession } from "@/lib/session";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/runtime-config", () => ({
  runtimeNewApiBaseUrl: vi.fn(async () => "http://newapi.test"),
  runtimeModelFixedCost: vi.fn(async () => null),
}));

const { GET } = await import("@/app/api/pricing/route");

let selfGroup = "Draw";
let modelGroups = ["ikun", "Draw"];
let groupsData: Record<string, { ratio?: number }> = { Draw: { ratio: 1.5 } };
let groupsStatus = 200;

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const pathname = new URL(String(input)).pathname;
  if (pathname === "/api/pricing")
    return Response.json({
      data: [{
        model_name: "nai-v5-full",
        enable_groups: modelGroups,
        quota_type: 1,
        billing_mode: "tiered_expr",
        billing_expr: 'tier("base", p * 260000 + c * 0)',
      }],
    });
  if (pathname === "/api/user/self")
    return Response.json({ success: true, data: { user: { group: selfGroup } } });
  if (pathname === "/api/user/self/groups")
    return Response.json({ success: true, data: groupsData }, { status: groupsStatus });
  throw new Error(`Unexpected request ${pathname}`);
});

async function pricingResponse() {
  const response = await GET(new Request("http://localhost/api/pricing?model=nai-v5-full"));
  return { response, body: await response.json() as Record<string, unknown> };
}

beforeEach(() => {
  selfGroup = "Draw";
  modelGroups = ["ikun", "Draw"];
  groupsData = { Draw: { ratio: 1.5 } };
  groupsStatus = 200;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(getSession).mockResolvedValue({ userId: 175 } as Awaited<ReturnType<typeof getSession>>);
});

afterEach(() => vi.unstubAllGlobals());

describe("pricing snapshot follows image-token group selection", () => {
  it("uses Draw when the model offers ikun but the user does not own it", async () => {
    const { response, body } = await pricingResponse();
    expect(response.status).toBe(200);
    expect(body.effectiveGroup).toBe("Draw");
    expect(body.groupRatio).toBe(1.5);
    expect(body.inEnvelopeUsd).toBe(9.75);
  });

  it("prefers ikun when the user owns it and the model enables it", async () => {
    selfGroup = "default";
    groupsData = { default: { ratio: 1 }, ikun: { ratio: 0.5 }, Draw: { ratio: 1.5 } };
    const { response, body } = await pricingResponse();
    expect(response.status).toBe(200);
    expect(body.effectiveGroup).toBe("ikun");
    expect(body.groupRatio).toBe(0.5);
    expect(body.inEnvelopeUsd).toBe(3.25);
  });

  it("does not invent a group or a ratio when access or metadata is missing", async () => {
    selfGroup = "default";
    groupsData = { default: { ratio: 1 } };
    expect((await pricingResponse()).response.status).toBe(403);

    selfGroup = "Draw";
    groupsData = { Draw: {} };
    expect((await pricingResponse()).response.status).toBe(502);

    groupsStatus = 503;
    expect((await pricingResponse()).response.status).toBe(502);
  });
});
