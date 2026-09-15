import { getSetting, setSetting } from "../db";

export type LandingCta = {
  enabled: boolean;
  text: string;
  buttonLabel: string;
  buttonUrl: string;
};

const KEY = "landing_cta";

const DEFAULT_CTA: LandingCta = {
  enabled: false,
  text: "",
  buttonLabel: "",
  buttonUrl: "",
};

/** Optional promo banner shown at the top of the public /store landing page — off by default,
 * configured by the seller (the landing page itself isn't shipped in the client download, so this
 * has no equivalent on a customer's own install). */
export function getLandingCta(): LandingCta {
  const raw = getSetting(KEY);
  if (!raw) return DEFAULT_CTA;
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: !!parsed.enabled,
      text: typeof parsed.text === "string" ? parsed.text : "",
      buttonLabel: typeof parsed.buttonLabel === "string" ? parsed.buttonLabel : "",
      buttonUrl: typeof parsed.buttonUrl === "string" ? parsed.buttonUrl : "",
    };
  } catch {
    return DEFAULT_CTA;
  }
}

export function setLandingCta(cta: LandingCta): void {
  setSetting(KEY, JSON.stringify(cta));
}
