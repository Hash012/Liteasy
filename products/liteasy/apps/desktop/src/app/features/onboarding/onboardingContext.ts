import { createContext, useContext } from "react";

export type OnboardingEntry = { start(): void; dismissInvitation(): void; invitation: boolean; error: string };
export const OnboardingContext = createContext<OnboardingEntry | null>(null);
export const useOnboarding = () => useContext(OnboardingContext);
