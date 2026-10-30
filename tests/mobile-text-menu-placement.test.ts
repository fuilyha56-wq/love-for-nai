import { afterEach, describe, expect, it, vi } from "vitest";
import { placeTextMenu, readTextMenuViewport } from "@/mobile/ui/text-menu-placement";

afterEach(() => vi.unstubAllGlobals());

describe("mobile text actions placement", () => {
  it("keeps a menu tapped near the keyboard inside the smaller visual viewport", () => {
    const placement = placeTextMenu({ x: 390, y: 680 }, { width: 260, height: 300 }, { left: 0, top: 0, width: 406, height: 484 });
    expect(placement).toEqual({ left: 138, top: 176, maxWidth: 390, maxHeight: 468 });
    expect(placement.top + 300).toBeLessThan(484);
  });

  it("includes visual viewport panning and caps oversized menus so their actions can scroll", () => {
    const placement = placeTextMenu({ x: 0, y: 0 }, { width: 260, height: 300 }, { left: 20, top: 100, width: 180, height: 220 });
    expect(placement).toEqual({ left: 28, top: 108, maxWidth: 164, maxHeight: 204 });
  });

  it("uses the workspace's restored height while browser metrics overshoot after keyboard dismissal", () => {
    vi.stubGlobal("window", { innerHeight: 864, innerWidth: 406, visualViewport: { height: 864, width: 406, offsetLeft: 0, offsetTop: 0 } });
    const values: Record<string, string> = { "--lfn-viewport-height": "754px", "--lfn-viewport-width": "406px", "--lfn-viewport-top": "0px", "--lfn-viewport-left": "0px" };
    vi.stubGlobal("document", { documentElement: { style: { getPropertyValue: (name: string) => values[name] || "" } } });
    expect(readTextMenuViewport()).toEqual({ left: 0, top: 0, width: 406, height: 754 });
  });

  it("uses visual viewport shrink immediately before the published workspace height catches up", () => {
    vi.stubGlobal("window", { innerHeight: 754, innerWidth: 406, visualViewport: { height: 374, width: 406, offsetLeft: 0, offsetTop: 0 } });
    const values: Record<string, string> = { "--lfn-viewport-height": "754px", "--lfn-viewport-width": "406px", "--lfn-viewport-top": "0px", "--lfn-viewport-left": "0px" };
    vi.stubGlobal("document", { documentElement: { style: { getPropertyValue: (name: string) => values[name] || "" } } });
    expect(readTextMenuViewport().height).toBe(374);
  });
});
