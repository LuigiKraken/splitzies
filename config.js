window.DOCK_CONFIG = {
  // Fraction of the panel reserved for the center STACK zone (0.01..0.95).
  // Larger values make center stacking easier to hit; smaller values leave
  // more area for directional split/equalize/wrap zones.
  centerFraction: 0.24,

  // Minimum thickness (px) used for directional interaction bands.
  // Prevents outer layers from becoming too thin to target accurately.
  minBandPx: 12,

  // Maximum number of ancestor levels considered for directional layers.
  // Higher values expose deeper structural operations, but can increase UI
  // complexity while dragging.
  maxDepth: 6,

  // Minimum panel width (px) allowed for split/wrap/equalize operations.
  // Blocks operations that would create or use panels smaller than this.
  minBoxWidthPx: 56,

  // Minimum panel height (px) allowed for split/wrap/equalize operations.
  // Keeps panels readable and avoids unusable tiny targets.
  minBoxHeightPx: 56,

  // Global cap on total box/tab count in the layout tree.
  // Useful as a safety guard for performance and stress-testing limits.
  maxTotalBoxCount: 30,

  // Maximum siblings allowed when stacking along the horizontal direction
  // (internally applied to the "column" axis).
  maxHorizontalStack: 6,

  // Maximum siblings allowed when stacking along the vertical direction
  // (internally applied to the "row" axis).
  maxVerticalStack: 6,

  // Milliseconds of relative pointer stillness before preview mode renders a
  // live "drop result" preview.
  previewIdleMs: 300,

  // Pointer movement threshold (px) treated as intentional motion during drag.
  // Helps filter micro-jitter so preview transitions feel stable.
  previewMoveThresholdPx: 4,

  // Extra hit width (px) around boundaries between siblings for equalize drops.
  betweenSiblingHitSlopPx: 10,

  // Initial drag visualization mode when app starts or resets.
  // Allowed: "hitbox" | "preview" | "combined"
  defaultPreviewMode: "preview",

  // Save/restore layout state from localStorage across reloads.
  persistLayout: true,

  // Number of discrete resize levels used when dragging panel corners.
  // Higher values allow finer snapped resizing; still never freeform.
  resizeSnapLevels: 8,

  // Enables stacking by dropping directly on the tab strip.
  // Keep false for a rectangle-only model where stacking happens via center zone.
  allowTabStripStackZone: false
};
