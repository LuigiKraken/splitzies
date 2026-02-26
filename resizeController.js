import { cloneNode, buildPanelInfoMap, findNodeById, axisForDirection, isBeforeDirection } from "./layoutModel.js";

export function createResizeController(config, workspaceEl, statusEl, { getRoot, setRoot, setActivePanelId, getDragCtx, renderWithoutPersist, renderAndPersist }) {
  let resizeSession = null;
  let gapHoverAxis = null;

  const HANDLE_DIRECTIONS = {
    "top-left": ["LEFT", "TOP"], "top-right": ["RIGHT", "TOP"],
    "bottom-left": ["LEFT", "BOTTOM"], "bottom-right": ["RIGHT", "BOTTOM"],
    "top": ["TOP"], "right": ["RIGHT"], "bottom": ["BOTTOM"], "left": ["LEFT"]
  };

  function findResizeTargetForDirection(root, panelInfo, direction) {
    if (!panelInfo || !Array.isArray(panelInfo.ancestors)) return null;
    const axis = axisForDirection(direction);
    const wantsBefore = isBeforeDirection(direction);
    for (let i = 1; i < panelInfo.ancestors.length; i++) {
      const container = panelInfo.ancestors[i];
      const childSubtree = panelInfo.ancestors[i - 1];
      if (!container || container.type !== "container" || !childSubtree) continue;
      if (container.axis !== axis) continue;
      const idx = container.children.findIndex((child) => child.id === childSubtree.id);
      if (idx === -1) continue;
      if (wantsBefore && idx > 0) {
        return { containerId: container.id, movingChildId: childSubtree.id, neighborChildId: container.children[idx - 1].id };
      }
      if (!wantsBefore && idx < container.children.length - 1) {
        return { containerId: container.id, movingChildId: childSubtree.id, neighborChildId: container.children[idx + 1].id };
      }
    }
    return null;
  }

  function getContainerSpanPx(containerId, axis) {
    const el = workspaceEl.querySelector(`.container[data-node-id="${containerId}"]`);
    if (!el) return 0;
    const bounds = el.getBoundingClientRect();
    return axis === "column" ? bounds.width : bounds.height;
  }

  function getMinSizePx(axis) {
    const wb = workspaceEl.getBoundingClientRect();
    return Math.max(1, (axis === "column" ? wb.width * config.minBoxWidthFraction : wb.height * config.minBoxHeightFraction));
  }

  function buildResizePlan(root, panelInfo, direction) {
    const target = findResizeTargetForDirection(root, panelInfo, direction);
    if (!target) return null;
    const axis = axisForDirection(direction);
    const containerFound = findNodeById(root, target.containerId);
    if (!containerFound || containerFound.node.type !== "container") return null;
    const movingIdx = containerFound.node.children.findIndex((c) => c.id === target.movingChildId);
    const neighborIdx = containerFound.node.children.findIndex((c) => c.id === target.neighborChildId);
    if (movingIdx === -1 || neighborIdx === -1) return null;

    const containerSpanPx = getContainerSpanPx(target.containerId, axis);
    if (!(containerSpanPx > 0)) return null;

    const startMovingRatio = containerFound.node.sizes[movingIdx] || 0;
    const startNeighborRatio = containerFound.node.sizes[neighborIdx] || 0;
    const pairPx = (startMovingRatio + startNeighborRatio) * containerSpanPx;
    const minSizePx = getMinSizePx(axis);
    if (!(pairPx > minSizePx * 2)) return null;

    const snappedSteps = Math.max(1, Math.min(config.resizeSnapLevels, Math.max(1, Math.floor(pairPx / minSizePx))));

    return {
      direction, axis, containerId: target.containerId,
      movingChildId: target.movingChildId, neighborChildId: target.neighborChildId,
      containerSpanPx, minSizePx, startMovingRatio, startNeighborRatio,
      snapUnitPx: pairPx / snappedSteps
    };
  }

  function applyResizePlan(nextRoot, plan, deltaX, deltaY) {
    const containerFound = findNodeById(nextRoot, plan.containerId);
    if (!containerFound || containerFound.node.type !== "container") return false;
    const movingIdx = containerFound.node.children.findIndex((c) => c.id === plan.movingChildId);
    const neighborIdx = containerFound.node.children.findIndex((c) => c.id === plan.neighborChildId);
    if (movingIdx === -1 || neighborIdx === -1) return false;

    const rawDelta = plan.axis === "column" ? deltaX : deltaY;
    const signedDelta = (plan.direction === "RIGHT" || plan.direction === "BOTTOM") ? rawDelta : -rawDelta;
    const movingStartPx = plan.startMovingRatio * plan.containerSpanPx;
    const pairPx = (plan.startMovingRatio + plan.startNeighborRatio) * plan.containerSpanPx;
    const minPx = plan.minSizePx;
    const maxPx = pairPx - minPx;
    if (!(maxPx > minPx)) return false;

    let movingPx = Math.max(minPx, Math.min(maxPx, movingStartPx + signedDelta));
    movingPx = Math.max(minPx, Math.min(maxPx, Math.round(movingPx / plan.snapUnitPx) * plan.snapUnitPx));

    const newMoving = movingPx / plan.containerSpanPx;
    const newNeighbor = (pairPx - movingPx) / plan.containerSpanPx;
    if (Math.abs(newMoving - containerFound.node.sizes[movingIdx]) < 1e-5
        && Math.abs(newNeighbor - containerFound.node.sizes[neighborIdx]) < 1e-5) return false;

    containerFound.node.sizes[movingIdx] = newMoving;
    containerFound.node.sizes[neighborIdx] = newNeighbor;
    return true;
  }

  function setGapHoverAxis(axis) {
    const next = axis || null;
    if (gapHoverAxis === next) return;
    gapHoverAxis = next;
    if (!next) delete workspaceEl.dataset.gapResizeAxis;
    else workspaceEl.dataset.gapResizeAxis = next;
  }

  function pickPanelIdForEdge(childWrap, edge) {
    const panels = Array.from(childWrap.querySelectorAll(".panel[data-panel-id]"));
    if (panels.length === 0) return null;
    let bestPanel = null, bestMetric = null;
    for (const panelEl of panels) {
      const rect = panelEl.getBoundingClientRect();
      const metric = edge === "right" ? rect.right : edge === "left" ? rect.left : edge === "top" ? rect.top : rect.bottom;
      if (!bestPanel) { bestPanel = panelEl; bestMetric = metric; continue; }
      const isBetter = (edge === "right" || edge === "bottom") ? metric > bestMetric : metric < bestMetric;
      if (isBetter) { bestPanel = panelEl; bestMetric = metric; }
    }
    return bestPanel ? bestPanel.dataset.panelId : null;
  }

  function findGapResizeCandidate(point) {
    const slop = Math.max(6, config.betweenSiblingHitSlopPx || 0);
    let best = null;
    for (const containerEl of workspaceEl.querySelectorAll(".container[data-node-id]")) {
      const childEls = Array.from(containerEl.children).filter((el) => el.classList.contains("child"));
      if (childEls.length < 2) continue;
      const isColumn = containerEl.classList.contains("column");
      const axis = isColumn ? "column" : "row";
      for (let i = 0; i < childEls.length - 1; i++) {
        const a = childEls[i].getBoundingClientRect();
        const b = childEls[i + 1].getBoundingClientRect();
        if (isColumn) {
          const overlapTop = Math.max(a.top, b.top), overlapBottom = Math.min(a.bottom, b.bottom);
          if (overlapBottom <= overlapTop) continue;
          const boundaryX = (a.right + b.left) / 2;
          if (Math.abs(point.x - boundaryX) > slop || point.y < overlapTop || point.y > overlapBottom) continue;
          const distance = Math.abs(point.x - boundaryX);
          if (!best || distance < best.distance) {
            const panelId = pickPanelIdForEdge(childEls[i], "right");
            if (panelId) best = { distance, axis, panelId, handle: "right" };
          }
        } else {
          const overlapLeft = Math.max(a.left, b.left), overlapRight = Math.min(a.right, b.right);
          if (overlapRight <= overlapLeft) continue;
          const boundaryY = (a.bottom + b.top) / 2;
          if (Math.abs(point.y - boundaryY) > slop || point.x < overlapLeft || point.x > overlapRight) continue;
          const distance = Math.abs(point.y - boundaryY);
          if (!best || distance < best.distance) {
            const panelId = pickPanelIdForEdge(childEls[i], "bottom");
            if (panelId) best = { distance, axis, panelId, handle: "bottom" };
          }
        }
      }
    }
    return best;
  }

  function startResizeSession(panelId, handle, pointerId, point) {
    if (getDragCtx()) { statusEl.textContent = "Finish the current drag before resizing."; return; }
    const root = getRoot();
    const panelInfo = buildPanelInfoMap(root).get(panelId);
    if (!panelInfo) return;
    const directions = HANDLE_DIRECTIONS[handle] || [];
    const plans = directions.map((d) => buildResizePlan(root, panelInfo, d)).filter(Boolean);
    if (plans.length === 0) { statusEl.textContent = "No adjacent resize boundary for that handle."; return; }

    setActivePanelId(panelId);
    resizeSession = { pointerId, startPoint: { ...point }, baseRoot: cloneNode(root), plans };
    workspaceEl.classList.add("resizing-layout");
    statusEl.textContent = "Resizing with snapped steps. Release to commit.";
  }

  function finishResizeSession(shouldCommit) {
    if (!resizeSession) return;
    const session = resizeSession;
    resizeSession = null;
    workspaceEl.classList.remove("resizing-layout");
    if (shouldCommit) { statusEl.textContent = "Resize committed."; renderAndPersist(); }
    else { setRoot(cloneNode(session.baseRoot)); statusEl.textContent = "Resize canceled."; renderWithoutPersist(); }
  }

  return {
    onResizeHandlePointerDown(e, panelId, handle) {
      if (e.button !== 0 || !e.isPrimary) return;
      e.preventDefault(); e.stopPropagation();
      startResizeSession(panelId, handle, e.pointerId, { x: e.clientX, y: e.clientY });
    },

    onWorkspacePointerDown(e) {
      if (resizeSession || getDragCtx()) return;
      if (e.button !== 0 || !e.isPrimary) return;
      if (e.target.closest(".resize-handle") || e.target.closest(".panel[data-panel-id]")) return;
      const point = { x: e.clientX, y: e.clientY };
      const candidate = findGapResizeCandidate(point);
      if (!candidate) return;
      e.preventDefault();
      startResizeSession(candidate.panelId, candidate.handle, e.pointerId, point);
      if (resizeSession) setGapHoverAxis(null);
    },

    onResizePointerMove(e) {
      if (!resizeSession) {
        if (getDragCtx()) { setGapHoverAxis(null); return; }
        const candidate = findGapResizeCandidate({ x: e.clientX, y: e.clientY });
        setGapHoverAxis(candidate ? candidate.axis : null);
        return;
      }
      if (e.pointerId !== resizeSession.pointerId) return;
      e.preventDefault();
      const dx = e.clientX - resizeSession.startPoint.x;
      const dy = e.clientY - resizeSession.startPoint.y;
      const nextRoot = cloneNode(resizeSession.baseRoot);
      let anyChange = false;
      for (const plan of resizeSession.plans) anyChange = applyResizePlan(nextRoot, plan, dx, dy) || anyChange;
      setRoot(nextRoot);
      renderWithoutPersist();
      statusEl.textContent = anyChange
        ? "Resizing with snapped steps. Release to commit."
        : "Resize snapped to current level (move farther to reach next step).";
    },

    onResizePointerUp(e) {
      if (!resizeSession || e.pointerId !== resizeSession.pointerId) return;
      e.preventDefault();
      finishResizeSession(true);
    },

    onResizePointerCancel(e) {
      if (!resizeSession || e.pointerId !== resizeSession.pointerId) return;
      finishResizeSession(false);
    },

    cancelActiveResize() {
      setGapHoverAxis(null);
      finishResizeSession(false);
    }
  };
}
