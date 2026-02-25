(function () {
  "use strict";

  const VIEW_MODES = ["hitbox", "preview", "combined"];

  const DEFAULTS = {
    // Center stack-zone fraction (0.01..0.95).
    centerFraction: 0.32,
    // Minimum directional band thickness in px.
    minBandPx: 12,
    // Max ancestor levels exposed as directional layers.
    maxDepth: 6,
    // Minimum panel width as a fraction of workspace width (0.01..1).
    minBoxWidthFraction: 0.08,
    // Minimum panel height as a fraction of workspace height (0.01..1).
    minBoxHeightFraction: 0.08,
    // Global cap on total boxes/tabs.
    maxTotalBoxCount: 30,
    // Max siblings in horizontal stacks (column axis).
    maxHorizontalStack: 6,
    // Max siblings in vertical stacks (row axis).
    maxVerticalStack: 6,
    // Idle time before drop preview appears.
    previewIdleMs: 300,
    // Pointer-move threshold used for preview jitter filtering.
    previewMoveThresholdPx: 4,
    // Extra hit slop around sibling boundaries.
    betweenSiblingHitSlopPx: 10,
    // Initial drag visualization mode: hitbox | preview | combined.
    defaultPreviewMode: "preview",
    // Persist layout state in localStorage.
    persistLayout: true,
    // Snapped resize levels.
    resizeSnapLevels: 8,
    // Duration of drop layout transition in milliseconds.
    dropTransitionMs: 130,
    // Duration of preview layout transition in milliseconds.
    previewTransitionMs: 90,
    // Allow stacking by dropping on tab strip.
    allowTabStripStackZone: true,
    // Minimum panel height fraction below which the tab strip stack zone is
    // suppressed to avoid conflicting with the center and directional zones.
    // Should be above minBoxHeightFraction but reachable via normal resizing.
    tabStripStackZoneMinHeightFraction: 0.12
  };

  const asPositiveNumber = (value, fallback) =>
    Number.isFinite(value) && value > 0 ? value : fallback;

  const asPositiveInt = (value, fallback) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const asNumberInRange = (value, fallback, min, max) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

  const asFraction = (value, fallback, min = 0.01, max = 1) => {
    if (!Number.isFinite(value)) return fallback;
    const normalized = value > 1 && value <= 100 ? value / 100 : value;
    return Math.max(min, Math.min(max, normalized));
  };

  const asBoolean = (value, fallback) =>
    typeof value === "boolean" ? value : fallback;

  const asStringEnum = (value, fallback, allowedValues) =>
    typeof value === "string" && allowedValues.includes(value) ? value : fallback;

  const resolveSizeFraction = (inputFraction, fallbackFraction) =>
    asFraction(inputFraction, asFraction(fallbackFraction, fallbackFraction));

  function normalizeConfig(input) {
    const d = DEFAULTS;
    return {
      centerFraction: asNumberInRange(input.centerFraction, d.centerFraction, 0.01, 0.95),
      minBandPx: asPositiveNumber(input.minBandPx, d.minBandPx),
      maxDepth: asPositiveInt(input.maxDepth, d.maxDepth),
      minBoxWidthFraction: resolveSizeFraction(input.minBoxWidthFraction, d.minBoxWidthFraction),
      minBoxHeightFraction: resolveSizeFraction(input.minBoxHeightFraction, d.minBoxHeightFraction),
      maxTotalBoxCount: asPositiveInt(input.maxTotalBoxCount, d.maxTotalBoxCount),
      maxHorizontalStack: asPositiveInt(input.maxHorizontalStack, d.maxHorizontalStack),
      maxVerticalStack: asPositiveInt(input.maxVerticalStack, d.maxVerticalStack),
      previewIdleMs: asPositiveInt(input.previewIdleMs, d.previewIdleMs),
      previewMoveThresholdPx: asPositiveNumber(input.previewMoveThresholdPx, d.previewMoveThresholdPx),
      betweenSiblingHitSlopPx: asPositiveNumber(input.betweenSiblingHitSlopPx, d.betweenSiblingHitSlopPx),
      defaultPreviewMode: asStringEnum(input.defaultPreviewMode, d.defaultPreviewMode, VIEW_MODES),
      persistLayout: asBoolean(input.persistLayout, d.persistLayout),
      dropTransitionMs: asPositiveInt(input.dropTransitionMs, d.dropTransitionMs),
      previewTransitionMs: asPositiveInt(input.previewTransitionMs, d.previewTransitionMs),
      allowTabStripStackZone: asBoolean(input.allowTabStripStackZone, d.allowTabStripStackZone),
      tabStripStackZoneMinHeightFraction: resolveSizeFraction(
        input.tabStripStackZoneMinHeightFraction,
        d.tabStripStackZoneMinHeightFraction
      ),
      resizeSnapLevels: asPositiveInt(input.resizeSnapLevels, d.resizeSnapLevels)
    };
  }

  const override = (window.DOCK_CONFIG_OVERRIDE && typeof window.DOCK_CONFIG_OVERRIDE === "object")
    ? window.DOCK_CONFIG_OVERRIDE
    : null;
  const raw = override ? { ...DEFAULTS, ...override } : DEFAULTS;

  window.DOCK_CONFIG = normalizeConfig(raw);
}());
