export type AnalyticsExperiment = {
  id: string;
  allocationVersion: number;
  startsAt: string;
  endsAt: string;
  variants: readonly { id: string; weight: number }[];
  exposureScreens: readonly string[];
};

/** Instrumentation is ready; a product experiment requires its own reviewed protocol. */
export const ANALYTICS_EXPERIMENTS: readonly AnalyticsExperiment[] = [];
