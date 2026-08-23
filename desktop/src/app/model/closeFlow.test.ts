import { describe, expect, it, vi } from "vitest";
import { closeInOrder } from "./closeFlow";

describe("closeInOrder", () => {
  it("runs every persistence boundary before destroying the window", async () => {
    const events: string[] = [];
    const result = await closeInOrder({
      prepareWorkspace: () => { events.push("workspace"); return Promise.resolve(true); },
      waitForSettingsMutation: () => { events.push("mutation"); return Promise.resolve(); },
      waitForSettingsWrites: () => { events.push("settings"); return Promise.resolve(); },
      settingsWriteFailed: () => false,
      destroyWindow: () => { events.push("destroy"); return Promise.resolve(); },
    });

    expect(result).toBe("closed");
    expect(events).toEqual(["workspace", "mutation", "settings", "destroy"]);
  });

  it("does not continue when workspace persistence fails", async () => {
    const destroyWindow = vi.fn();
    const waitForSettingsMutation = vi.fn();
    const result = await closeInOrder({
      prepareWorkspace: () => Promise.resolve(false),
      waitForSettingsMutation,
      waitForSettingsWrites: vi.fn(),
      settingsWriteFailed: () => false,
      destroyWindow,
    });

    expect(result).toBe("workspace-blocked");
    expect(waitForSettingsMutation).not.toHaveBeenCalled();
    expect(destroyWindow).not.toHaveBeenCalled();
  });

  it("does not destroy the window after the latest settings write fails", async () => {
    const destroyWindow = vi.fn();
    const result = await closeInOrder({
      prepareWorkspace: () => Promise.resolve(true),
      waitForSettingsMutation: () => Promise.resolve(),
      waitForSettingsWrites: () => Promise.resolve(),
      settingsWriteFailed: () => true,
      destroyWindow,
    });

    expect(result).toBe("settings-blocked");
    expect(destroyWindow).not.toHaveBeenCalled();
  });
});
