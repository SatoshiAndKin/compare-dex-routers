type FeatureFlag = "compare_endpoint" | "metrics_endpoint";

const FLAGS: Record<FeatureFlag, boolean> = {
  compare_endpoint: process.env.COMPARE_ENABLED !== "false",
  metrics_endpoint: process.env.METRICS_ENABLED !== "false",
};

export function isEnabled(flag: FeatureFlag): boolean {
  return FLAGS[flag] ?? false;
}

export function getAllFlags(): Record<string, boolean> {
  return { ...FLAGS };
}
