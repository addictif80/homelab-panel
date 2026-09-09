import { getSetting, setSetting } from "./db";
import { DEFAULT_THRESHOLDS, type DetectionThresholds } from "./logAnalysis";

const KEY = "log_detection_thresholds";

export function getDetectionThresholds(): DetectionThresholds {
  const raw = getSetting(KEY);
  if (!raw) return DEFAULT_THRESHOLDS;
  try {
    const parsed = JSON.parse(raw);
    return {
      authFailure: Number(parsed.authFailure) || DEFAULT_THRESHOLDS.authFailure,
      notFound: Number(parsed.notFound) || DEFAULT_THRESHOLDS.notFound,
      highVolume: Number(parsed.highVolume) || DEFAULT_THRESHOLDS.highVolume,
    };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

export function setDetectionThresholds(thresholds: DetectionThresholds): void {
  setSetting(KEY, JSON.stringify(thresholds));
}
