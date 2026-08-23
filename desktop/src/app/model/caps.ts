import type { Settings } from "../../shared/api/sidecar";

/**
 * What the app can do, derived once from the saved settings at the
 * composition layer. Components take `caps` instead of re-deriving
 * `settings.aiEnabled` each on their own — one gate, one definition.
 * The API key is deliberately not part of caps: it says whether AI can
 * actually run, while `caps.ai` says whether AI mode is on at all.
 */
export interface Caps {
  ai: boolean;
}

export function deriveCaps(settings: Settings): Caps {
  return { ai: settings.aiEnabled };
}
