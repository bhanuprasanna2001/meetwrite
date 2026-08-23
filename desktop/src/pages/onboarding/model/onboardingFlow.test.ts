import { describe, expect, it } from "vitest";
import {
  nextOnboardingStep,
  onboardingStepNumber,
  ONBOARDING_STEPS,
} from "./onboardingFlow";

describe("onboarding steps", () => {
  it("keeps the full AI and permission flow for Notes + AI", () => {
    expect(ONBOARDING_STEPS["notes-ai"]).toEqual([
      "theme",
      "mode",
      "name",
      "key",
      "microphone",
      "systemAudio",
      "done",
    ]);
  });

  it("skips every AI and permission step for Notes only", () => {
    expect(ONBOARDING_STEPS["notes-only"]).toEqual([
      "theme",
      "mode",
      "name",
      "done",
    ]);
  });

  it("advances along the active list only", () => {
    expect(nextOnboardingStep("theme", "notes-only")).toBe("mode");
    expect(nextOnboardingStep("mode", "notes-only")).toBe("name");
    expect(nextOnboardingStep("name", "notes-only")).toBe("done");
    expect(nextOnboardingStep("done", "notes-only")).toBe("done");
    expect(nextOnboardingStep("name", "notes-ai")).toBe("key");
  });

  it("numbers steps against the active list", () => {
    expect(onboardingStepNumber("theme", "notes-only")).toBe(1);
    expect(onboardingStepNumber("done", "notes-only")).toBe(4);
    expect(onboardingStepNumber("systemAudio", "notes-ai")).toBe(6);
  });
});
