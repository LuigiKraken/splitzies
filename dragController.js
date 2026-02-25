(function attachDragController(global) {
  "use strict";

  function create(deps) {
    const { previewMoveThresholdPx } = deps;

    const state = {
      dragCtx: null,
      hoverPreview: null,
      lastDragPoint: null,
      dragPreviewTimer: null,
      previewIdleTimer: null,
      dragVisualState: "hitbox",
      hoverAnchorPoint: null
    };

    function setDragCtx(value) {
      state.dragCtx = value;
    }

    function getDragCtx() {
      return state.dragCtx;
    }

    function setHoverPreview(value) {
      state.hoverPreview = value;
    }

    function getHoverPreview() {
      return state.hoverPreview;
    }

    function setLastDragPoint(value) {
      state.lastDragPoint = value;
    }

    function getLastDragPoint() {
      return state.lastDragPoint;
    }

    function setDragVisualState(value) {
      state.dragVisualState = value;
    }

    function setHoverAnchorPoint(value) {
      state.hoverAnchorPoint = value;
    }

    function stopPreviewIdleTimer() {
      if (!state.previewIdleTimer) return;
      clearTimeout(state.previewIdleTimer);
      state.previewIdleTimer = null;
    }

    function stopDragPreviewTimer() {
      if (!state.dragPreviewTimer) return;
      clearInterval(state.dragPreviewTimer);
      state.dragPreviewTimer = null;
    }

    function schedulePreviewIdle(callback, idleMs) {
      stopPreviewIdleTimer();
      state.previewIdleTimer = window.setTimeout(callback, idleMs);
    }

    function startDragPreviewTimer(callback, intervalMs) {
      stopDragPreviewTimer();
      state.dragPreviewTimer = window.setInterval(callback, intervalMs);
    }

    function getPointerDistance(a, b) {
      if (!a || !b) return Infinity;
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function handlePreviewModeDragOver(x, y, onMovedBeyondThreshold) {
      const point = { x, y };
      const movedDistance = getPointerDistance(state.hoverAnchorPoint, point);
      if (!state.hoverAnchorPoint || movedDistance > previewMoveThresholdPx) {
        state.hoverAnchorPoint = point;
        onMovedBeyondThreshold(point);
      }
    }

    function resetDragSession() {
      state.dragCtx = null;
      state.hoverPreview = null;
      state.lastDragPoint = null;
      state.hoverAnchorPoint = null;
      state.dragVisualState = "hitbox";
      stopDragPreviewTimer();
      stopPreviewIdleTimer();
    }

    function hasTransientState() {
      return !!(state.dragCtx || state.hoverPreview);
    }

    return {
      setDragCtx,
      getDragCtx,
      setHoverPreview,
      getHoverPreview,
      setLastDragPoint,
      getLastDragPoint,
      setDragVisualState,
      setHoverAnchorPoint,
      stopPreviewIdleTimer,
      stopDragPreviewTimer,
      schedulePreviewIdle,
      startDragPreviewTimer,
      handlePreviewModeDragOver,
      resetDragSession,
      hasTransientState
    };
  }

  global.DragController = {
    create
  };
})(window);
