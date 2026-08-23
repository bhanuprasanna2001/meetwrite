/**
 * The onboarding path is chosen once, on the first steps, and is then fixed:
 *
 *   theme → mode → name → key → microphone → system audio → done  (Notes + AI)
 *   theme → mode → name → done                                    (Notes only)
 *
 * The theme step resolves the OS appearance as its starting choice. The mode
 * step decides which later steps exist. There is no back button, so neither
 * choice can change halfway through.
 */

export type OnboardingAiChoice = "notes-only" | "notes-ai";

export type OnboardingStep =
  | "theme"
  | "mode"
  | "name"
  | "key"
  | "microphone"
  | "systemAudio"
  | "done";

export const ONBOARDING_STEPS: Record<OnboardingAiChoice, readonly OnboardingStep[]> = {
  "notes-ai": ["theme", "mode", "name", "key", "microphone", "systemAudio", "done"],
  "notes-only": ["theme", "mode", "name", "done"],
};

export function nextOnboardingStep(
  step: OnboardingStep,
  choice: OnboardingAiChoice,
): OnboardingStep {
  const steps = ONBOARDING_STEPS[choice];
  const index = steps.indexOf(step);
  return steps[Math.min(index + 1, steps.length - 1)];
}

export function onboardingStepNumber(
  step: OnboardingStep,
  choice: OnboardingAiChoice,
): number {
  return ONBOARDING_STEPS[choice].indexOf(step) + 1;
}
