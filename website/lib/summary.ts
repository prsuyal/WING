import { shareTokenPattern } from "./public-summary.ts";
export {
  publicSummarySchema as summarySchema,
  type PublicSummary as PlanningSummary,
} from "./public-summary.ts";
export const validToken = (token: string) => shareTokenPattern.test(token);
