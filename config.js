window.DOCK_CONFIG = {
  // Center stack-zone fraction (0.01..0.95).
  centerFraction: 0.32,
  // Minimum directional band thickness in px.
  minBandPx: 12,
  // Max ancestor levels exposed as directional layers.
  maxDepth: 6,
  // Minimum panel width in px for layout operations.
  minBoxWidthPx: 56,
  // Minimum panel height in px for layout operations.
  minBoxHeightPx: 56,
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
  // Allow stacking by dropping on tab strip.
  allowTabStripStackZone: true,
  // Minimum panel height in px below which the tab strip stack zone is
  // suppressed to avoid conflicting with the center and directional zones.
  tabStripStackZoneMinHeightPx: 120
};
