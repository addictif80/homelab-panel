/**
 * Shared between scripts/generate-pwa-icons.ts (which rasterizes one PNG per entry x orientation
 * x theme into public/splash/) and src/app/layout.tsx (which points an
 * <link rel="apple-touch-startup-image"> at each one) — kept as the single source of truth so the
 * two can't silently drift apart. Logical CSS width/height/devicePixelRatio for every iOS form
 * factor this panel is realistic to be installed on, the same values Apple documents for
 * apple-touch-startup-image media queries.
 */
export const IOS_SPLASH_DEVICES: readonly [name: string, width: number, height: number, ratio: number][] = [
  ["iphone-se", 375, 667, 2],
  ["iphone-standard", 390, 844, 3],
  ["iphone-pro", 393, 852, 3],
  ["iphone-plus", 414, 736, 3],
  ["iphone-xr-11", 414, 896, 2],
  ["iphone-max", 428, 926, 3],
  ["iphone-pro-max", 430, 932, 3],
  ["ipad", 768, 1024, 2],
  ["ipad-air", 820, 1180, 2],
  ["ipad-pro-11", 834, 1194, 2],
  ["ipad-pro-129", 1024, 1366, 2],
];
