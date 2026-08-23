// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../shared/api/client";
import type * as SidecarModule from "../../shared/api/sidecar";

const sidecar = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSettings: vi.fn(),
  getKeyStatus: vi.fn(),
  listTemplates: vi.fn(),
  listDictionary: vi.fn(),
  getOrCreateDailyNote: vi.fn(),
  saveSettings: vi.fn(),
}));

const workspace = vi.hoisted(() => ({
  controller: {
    entry: null,
    entries: [],
    status: { status: "idle" },
    recording: { recording: false, toggle: vi.fn() },
    chat: { activeChatId: null },
    enhance: { activeVersion: null, activeVersionId: null, busy: false, versions: [] },
    initialize: vi.fn(),
    newEntry: vi.fn(),
    openEntry: vi.fn(),
    refreshEntries: vi.fn(),
    prepareForAiOff: vi.fn(),
    prepareForClose: vi.fn(),
    prepareForSettings: vi.fn(),
    saveBeforeUnload: vi.fn(),
  },
}));

vi.mock("../../shared/api/sidecar", async (importOriginal) => {
  const actual = await importOriginal<typeof SidecarModule>();
  return {
    ...actual,
    getUser: sidecar.getUser,
    getSettings: sidecar.getSettings,
    getKeyStatus: sidecar.getKeyStatus,
    listTemplates: sidecar.listTemplates,
    listDictionary: sidecar.listDictionary,
    getOrCreateDailyNote: sidecar.getOrCreateDailyNote,
    saveSettings: sidecar.saveSettings,
  };
});

vi.mock("../../pages/workspace/model/useWorkspace", () => ({
  useWorkspace: () => workspace.controller,
}));

vi.mock("../../shared/platform/theme", () => ({
  applyTheme: vi.fn(),
  cachedTheme: () => "light",
  systemPreferredTheme: () => "light",
  startupTheme: () => "light",
}));

import { getUserWhenReady, useAppController } from "./useAppController";

const offlineError = () =>
  new ApiError({
    kind: "offline",
    method: "GET",
    path: "/me",
    message: "offline",
  });

describe("getUserWhenReady", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sidecar.getUser.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries offline failures and returns the first successful lookup", async () => {
    const user = { id: 7, name: "Bhanu" };
    sidecar.getUser
      .mockRejectedValueOnce(offlineError())
      .mockRejectedValueOnce(offlineError())
      .mockResolvedValueOnce(user);

    const lookup = getUserWhenReady();
    await vi.runAllTimersAsync();

    await expect(lookup).resolves.toEqual(user);
    expect(sidecar.getUser).toHaveBeenCalledTimes(3);
  });

  it("does not retry a server response as though it were a startup connection failure", async () => {
    const failure = new ApiError({
      kind: "server",
      method: "GET",
      path: "/me",
      status: 503,
      message: "Sidecar failed",
    });
    sidecar.getUser.mockRejectedValue(failure);

    await expect(getUserWhenReady()).rejects.toBe(failure);
    expect(sidecar.getUser).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns the no-user result without retrying", async () => {
    sidecar.getUser.mockResolvedValue(null);

    await expect(getUserWhenReady()).resolves.toBeNull();
    expect(sidecar.getUser).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useAppController", () => {
  beforeEach(() => {
    sidecar.getUser.mockClear();
    sidecar.getSettings.mockClear();
    sidecar.getKeyStatus.mockClear();
    sidecar.listTemplates.mockClear();
    sidecar.listDictionary.mockClear();
    sidecar.getOrCreateDailyNote.mockClear();
    sidecar.saveSettings.mockClear();
    workspace.controller.initialize.mockClear();
    workspace.controller.openEntry.mockClear();
    workspace.controller.refreshEntries.mockClear();
  });

  it("moves from loading to ready after the workspace starts", async () => {
    const settings = {
      theme: "dark" as const,
      noteFont: "lato" as const,
      noteFontSize: 20,
      enterMeetingOnRecord: true,
      aiEnabled: true,
      dailyNoteEnabled: false,
      dailyNoteFolderId: null,
      dailyNoteTime: "08:00",
    };
    sidecar.getUser.mockResolvedValue({ id: 7, name: "Bhanu" });
    sidecar.getSettings.mockResolvedValue(settings);
    sidecar.getKeyStatus.mockResolvedValue(true);
    sidecar.listTemplates.mockResolvedValue([]);
    sidecar.listDictionary.mockResolvedValue([]);
    workspace.controller.initialize.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAppController());

    expect(result.current.boot).toEqual({ status: "loading" });
    await waitFor(() => {
      expect(result.current.boot).toEqual({ status: "ready", settings });
    });
    expect(workspace.controller.initialize).toHaveBeenCalledOnce();
  });

  it("creates today's note on the clock at the chosen time, without navigating", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 23, 7, 59, 0));
    const settings = {
      theme: "light" as const,
      noteFont: "lato" as const,
      noteFontSize: 20,
      enterMeetingOnRecord: true,
      aiEnabled: true,
      dailyNoteEnabled: true,
      dailyNoteFolderId: 2,
      dailyNoteTime: "08:00",
    };
    sidecar.getUser.mockResolvedValue({ id: 7, name: "Bhanu" });
    sidecar.getSettings.mockResolvedValue(settings);
    sidecar.getKeyStatus.mockResolvedValue(true);
    sidecar.listTemplates.mockResolvedValue([]);
    sidecar.listDictionary.mockResolvedValue([]);
    sidecar.getOrCreateDailyNote.mockResolvedValue({
      entry: { id: 99 },
      created: true,
    });
    sidecar.saveSettings.mockResolvedValue(undefined);
    workspace.controller.initialize.mockResolvedValue(undefined);
    workspace.controller.refreshEntries.mockResolvedValue(undefined);

    try {
      const { result } = renderHook(() => useAppController());
      // Boot is a chain of awaited microtasks; flush them without touching
      // the clock (the scheduler timer is a whole minute away).
      for (let i = 0; i < 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {});
      }
      expect(result.current.boot.status).toBe("ready");
      // The chosen time is still ahead — launch leaves the note to the clock.
      expect(sidecar.getOrCreateDailyNote).not.toHaveBeenCalled();

      // One minute later the clock fires exactly once.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sidecar.getOrCreateDailyNote).toHaveBeenCalledOnce();
      expect(sidecar.getOrCreateDailyNote).toHaveBeenCalledWith("2026-08-23", 2);
      // The note lands in its folder — the app never navigates to it.
      expect(workspace.controller.openEntry).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("turning the switch on creates today's note without leaving settings", async () => {
    const settings = {
      theme: "light" as const,
      noteFont: "lato" as const,
      noteFontSize: 20,
      enterMeetingOnRecord: true,
      aiEnabled: true,
      dailyNoteEnabled: false,
      dailyNoteFolderId: null,
      dailyNoteTime: "08:00",
    };
    sidecar.getUser.mockResolvedValue({ id: 7, name: "Bhanu" });
    sidecar.getSettings.mockResolvedValue(settings);
    sidecar.getKeyStatus.mockResolvedValue(true);
    sidecar.listTemplates.mockResolvedValue([]);
    sidecar.listDictionary.mockResolvedValue([]);
    sidecar.getOrCreateDailyNote.mockResolvedValue({
      entry: { id: 99 },
      created: true,
    });
    sidecar.saveSettings.mockResolvedValue(undefined);
    workspace.controller.initialize.mockResolvedValue(undefined);
    workspace.controller.refreshEntries.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAppController());
    await waitFor(() => {
      expect(result.current.boot.status).toBe("ready");
    });

    act(() => result.current.enableDailyNote());

    await waitFor(() => {
      expect(sidecar.getOrCreateDailyNote).toHaveBeenCalledOnce();
    });
    expect(workspace.controller.openEntry).not.toHaveBeenCalled();
  });
});
