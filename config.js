const DEFAULTS = {
  centerFraction: 0.32,            // Center stack-zone fraction (0.01..0.95)
  minBandPx: 12,                   // Minimum directional band thickness in px
  maxDepth: 6,                     // Max ancestor levels exposed as directional layers
  minBoxWidthFraction: 0.08,       // Minimum panel width as fraction of workspace width
  minBoxHeightFraction: 0.08,      // Minimum panel height as fraction of workspace height
  maxTotalBoxCount: 30,            // Global cap on total boxes/tabs
  maxHorizontalStack: 6,           // Max siblings in horizontal stacks (column axis)
  maxVerticalStack: 6,             // Max siblings in vertical stacks (row axis)
  previewIdleMs: 60,               // Idle time before drop preview appears
  previewMoveThresholdPx: 4,       // Pointer-move threshold for preview jitter filtering
  betweenSiblingHitSlopPx: 10,     // Extra hit slop around sibling boundaries
  defaultPreviewMode: "preview",   // Initial drag visualization: hitbox | preview | combined
  persistLayout: true,             // Persist layout state in localStorage
  resizeSnapLevels: 8,             // Snapped resize levels
  dropTransitionMs: 130,           // Duration of drop layout transition
  previewTransitionMs: 90,         // Duration of preview layout transition
  allowTabStripStackZone: true,    // Allow stacking by dropping on tab strip
  tabStripStackZoneMinHeightFraction: 0.12
};

export const VIEW_MODES = ["hitbox", "preview", "combined"];

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function normalizeConfig(raw) {
  const c = { ...DEFAULTS, ...raw };
  c.centerFraction = clamp(c.centerFraction, 0.01, 0.95);
  c.minBoxWidthFraction = clamp(c.minBoxWidthFraction, 0.01, 1);
  c.minBoxHeightFraction = clamp(c.minBoxHeightFraction, 0.01, 1);
  c.tabStripStackZoneMinHeightFraction = clamp(c.tabStripStackZoneMinHeightFraction, 0.01, 1);
  if (!VIEW_MODES.includes(c.defaultPreviewMode)) c.defaultPreviewMode = DEFAULTS.defaultPreviewMode;
  return c;
}

const override = (typeof window.SPLITZIES_CONFIG === "object" && window.SPLITZIES_CONFIG)
  ? window.SPLITZIES_CONFIG
  : {};

export const CONFIG = Object.freeze(normalizeConfig(override));
