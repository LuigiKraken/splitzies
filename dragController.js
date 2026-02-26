export function createDragController(previewMoveThresholdPx) {
  const state = {
    dragCtx: null,
    hoverPreview: null,
    lastDragPoint: null,
    dragPreviewTimer: null,
    previewIdleTimer: null,
    hoverAnchorPoint: null
  };

  function stopPreviewIdleTimer() {
    if (state.previewIdleTimer) { clearTimeout(state.previewIdleTimer); state.previewIdleTimer = null; }
  }

  function stopDragPreviewTimer() {
    if (state.dragPreviewTimer) { clearInterval(state.dragPreviewTimer); state.dragPreviewTimer = null; }
  }

  function resetDragSession() {
    state.dragCtx = null;
    state.hoverPreview = null;
    state.lastDragPoint = null;
    state.hoverAnchorPoint = null;
    stopDragPreviewTimer();
    stopPreviewIdleTimer();
  }

  function handlePreviewModeDragOver(x, y, onMovedBeyondThreshold) {
    const point = { x, y };
    const dist = state.hoverAnchorPoint
      ? Math.hypot(state.hoverAnchorPoint.x - x, state.hoverAnchorPoint.y - y)
      : Infinity;
    if (!state.hoverAnchorPoint || dist > previewMoveThresholdPx) {
      state.hoverAnchorPoint = point;
      onMovedBeyondThreshold(point);
    }
  }

  return {
    get dragCtx() { return state.dragCtx; },
    set dragCtx(v) { state.dragCtx = v; },
    get hoverPreview() { return state.hoverPreview; },
    set hoverPreview(v) { state.hoverPreview = v; },
    get lastDragPoint() { return state.lastDragPoint; },
    set lastDragPoint(v) { state.lastDragPoint = v; },
    set hoverAnchorPoint(v) { state.hoverAnchorPoint = v; },

    stopPreviewIdleTimer,
    stopDragPreviewTimer,

    schedulePreviewIdle(callback, idleMs) {
      stopPreviewIdleTimer();
      state.previewIdleTimer = setTimeout(callback, idleMs);
    },

    startDragPreviewTimer(callback, intervalMs) {
      stopDragPreviewTimer();
      state.dragPreviewTimer = setInterval(callback, intervalMs);
    },

    handlePreviewModeDragOver,
    resetDragSession,
    hasTransientState() { return !!(state.dragCtx || state.hoverPreview); }
  };
}
