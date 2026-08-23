// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sidecar = vi.hoisted(() => ({
  saveEntryKeepalive: vi.fn(),
  saveEnhancedVersionKeepalive: vi.fn(),
  updateEnhancedVersion: vi.fn(),
  updateEntry: vi.fn(),
}));

vi.mock("../../../shared/api/sidecar", () => sidecar);
vi.mock("../../../shared/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { SAVE_DELAY_MS, useAutosave } from "./autosave";

describe("useAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sidecar.saveEntryKeepalive.mockReset();
    sidecar.saveEnhancedVersionKeepalive.mockReset();
    sidecar.updateEntry.mockReset().mockResolvedValue(undefined);
    sidecar.updateEnhancedVersion.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces rapid edits and persists every edited version in stable order", async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ onSaved }));

    act(() => {
      result.current.queue({ entryId: 9, noteMd: "first" });
      result.current.queue({ entryId: 9, noteMd: "latest" });
      result.current.queue({ entryId: 9, version: { id: 12, content: "twelve" } });
      result.current.queue({ entryId: 9, version: { id: 3, content: "three" } });
    });
    await act(async () => vi.advanceTimersByTimeAsync(SAVE_DELAY_MS));

    expect(sidecar.updateEntry).toHaveBeenCalledTimes(1);
    expect(sidecar.updateEntry).toHaveBeenCalledWith(9, "latest");
    expect(sidecar.updateEnhancedVersion.mock.calls).toEqual([
      [3, "three"],
      [12, "twelve"],
    ]);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("retains a failed batch and clears the error after an explicit retry", async () => {
    sidecar.updateEntry.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useAutosave({ onSaved: vi.fn() }));

    act(() => result.current.queue({ entryId: 4, noteMd: "must survive" }));
    await act(async () => vi.advanceTimersByTimeAsync(SAVE_DELAY_MS));
    expect(result.current.error).toContain("could not be saved");

    let saved = false;
    await act(async () => {
      saved = await result.current.flush();
    });
    expect(saved).toBe(true);
    expect(sidecar.updateEntry).toHaveBeenLastCalledWith(4, "must survive");
    expect(result.current.error).toBeNull();
  });

  it("serializes an edit queued while an older save is still in flight", async () => {
    let finishOlder: (() => void) | undefined;
    let finishNewer: (() => void) | undefined;
    sidecar.updateEntry
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => { finishOlder = resolve; }),
      )
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => { finishNewer = resolve; }),
      );
    const { result } = renderHook(() => useAutosave({ onSaved: vi.fn() }));

    act(() => result.current.queue({ entryId: 5, noteMd: "older" }));
    let firstFlush!: Promise<boolean>;
    await act(async () => {
      firstFlush = result.current.flush();
      await Promise.resolve();
    });
    expect(sidecar.updateEntry.mock.calls).toEqual([[5, "older"]]);

    act(() => result.current.queue({ entryId: 5, noteMd: "newer" }));
    let secondFlush!: Promise<boolean>;
    await act(async () => {
      secondFlush = result.current.flush();
      await Promise.resolve();
    });
    expect(sidecar.updateEntry).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishOlder?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sidecar.updateEntry.mock.calls).toEqual([
      [5, "older"],
      [5, "newer"],
    ]);

    await act(async () => {
      finishNewer?.();
      await Promise.all([firstFlush, secondFlush]);
    });
  });

  it("restores a failed active batch without overwriting a newer queued edit", async () => {
    let failOlder: ((error: Error) => void) | undefined;
    sidecar.updateEntry.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          failOlder = reject;
        }),
    );
    const { result } = renderHook(() => useAutosave({ onSaved: vi.fn() }));

    act(() => result.current.queue({ entryId: 5, noteMd: "older" }));
    let activeFlush!: Promise<boolean>;
    await act(async () => {
      activeFlush = result.current.flush();
      await Promise.resolve();
    });

    act(() => result.current.queue({ entryId: 5, noteMd: "newer" }));
    let joinedFlush!: Promise<boolean>;
    await act(async () => {
      joinedFlush = result.current.flush();
      await Promise.resolve();
    });

    let activeSucceeded = true;
    let joinedSucceeded = true;
    await act(async () => {
      failOlder?.(new Error("offline"));
      [activeSucceeded, joinedSucceeded] = await Promise.all([activeFlush, joinedFlush]);
    });
    expect(activeSucceeded).toBe(false);
    expect(joinedSucceeded).toBe(false);
    expect(result.current.error).toContain("could not be saved");

    let retrySucceeded = false;
    await act(async () => {
      retrySucceeded = await result.current.flush();
    });
    expect(retrySucceeded).toBe(true);
    expect(sidecar.updateEntry.mock.calls).toEqual([
      [5, "older"],
      [5, "newer"],
    ]);
  });

  it("uses the newest merged values for teardown while a save is active", async () => {
    let finishActive: (() => void) | undefined;
    sidecar.updateEntry.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishActive = resolve;
        }),
    );
    const { result } = renderHook(() => useAutosave({ onSaved: vi.fn() }));

    act(() => {
      result.current.queue({ entryId: 6, noteMd: "older" });
      result.current.queue({ entryId: 6, version: { id: 8, content: "old eight" } });
      result.current.queue({ entryId: 6, version: { id: 9, content: "active nine" } });
    });
    let activeFlush!: Promise<boolean>;
    await act(async () => {
      activeFlush = result.current.flush();
      await Promise.resolve();
    });

    act(() => {
      result.current.queue({ entryId: 6, noteMd: "newer" });
      result.current.queue({ entryId: 6, version: { id: 8, content: "new eight" } });
      result.current.queue({ entryId: 6, version: { id: 10, content: "pending ten" } });
      result.current.saveBeforeUnload();
    });

    expect(sidecar.saveEntryKeepalive).toHaveBeenCalledWith(6, "newer");
    expect(sidecar.saveEnhancedVersionKeepalive.mock.calls).toEqual([
      [8, "new eight"],
      [9, "active nine"],
      [10, "pending ten"],
    ]);

    await act(async () => {
      finishActive?.();
      await activeFlush;
    });
  });

  it("sends the complete pending batch during page teardown", () => {
    const { result } = renderHook(() => useAutosave({ onSaved: vi.fn() }));
    act(() => {
      result.current.queue({ entryId: 6, noteMd: "latest" });
      result.current.queue({ entryId: 6, version: { id: 8, content: "version" } });
      result.current.saveBeforeUnload();
    });

    expect(sidecar.saveEntryKeepalive).toHaveBeenCalledWith(6, "latest");
    expect(sidecar.saveEnhancedVersionKeepalive).toHaveBeenCalledWith(8, "version");
  });
});
