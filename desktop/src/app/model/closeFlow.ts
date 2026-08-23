export type CloseResult = "closed" | "workspace-blocked" | "settings-blocked";

interface CloseFlow {
  prepareWorkspace: () => Promise<boolean>;
  waitForSettingsMutation: () => Promise<void>;
  waitForSettingsWrites: () => Promise<void>;
  settingsWriteFailed: () => boolean;
  destroyWindow: () => Promise<void>;
}

/** The single accepted close order. Failures stop before the destructive step. */
export async function closeInOrder(flow: CloseFlow): Promise<CloseResult> {
  if (!(await flow.prepareWorkspace())) return "workspace-blocked";
  await flow.waitForSettingsMutation();
  await flow.waitForSettingsWrites();
  if (flow.settingsWriteFailed()) return "settings-blocked";
  await flow.destroyWindow();
  return "closed";
}
