import { z } from "zod";

export const onboardingFields = ["departureAirport", "timeZone", "homeAirport", "budgetCents", "baggage", "nonstop", "calendar"] as const;
export const onboardingSchema = z.object({ introduced: z.boolean(), active: z.boolean(), skipped: z.array(z.enum(onboardingFields)).max(7) }).strict();
export type Onboarding = z.infer<typeof onboardingSchema>;
export function nextOnboarding(facts: Record<string, unknown>, skipped: string[], calendarConnected: boolean) {
  return (["departureAirport", "calendar", "homeAirport", "baggage", "nonstop"] as const).find((field) => !skipped.includes(field) && (field === "calendar" ? !calendarConnected : facts[field] === undefined));
}
export const onboardingQuestions = {
  departureAirport: "where do you usually fly from?",
  timeZone: "what time zone are you usually in?",
  homeAirport: "what airport do you use when you fly home? you can skip this",
  budgetCents: "any usual flight budget, or should i just find the cheapest?",
  baggage: "do you usually bring a carry-on or check a bag?",
  nonstop: "are layovers okay if they're cheaper?",
  calendar: "want to connect Google Calendar so i can find flights around your schedule?",
};
export const introduction = "hey, i'm wing ✈️\n\ni find real flights around your schedule, watch prices and help organize your trips";
export const welcome = `${introduction}\n\n${onboardingQuestions.departureAirport}`;
export const greeting = /^(hi|hey|hello|yo|sup|hiya|heyy+|start|hi wing|hey wing)[!.\s]*$/i;
