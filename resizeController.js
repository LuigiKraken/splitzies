(function attachResizeController(global) {
  "use strict";

  function create(deps) {
    const {
      config,
      workspaceEl,
      statusEl,
      getRoot,
      setRoot,
      setActivePanelId,
      cloneNode,
      buildPanelInfoMap,
      findNodeById,
      axisForDirection,
      isBeforeDirection,
      getDragCtx,
      renderWithoutPersist,
      renderAndPersist
    } = deps;

    let resizeSession = null;
    let gapHoverAxis = null;

    function getResizeDirectionsForHandle(handle) {
      if (handle === "top-left") return ["LEFT", "TOP"];
      if (handle === "top-right") return ["RIGHT", "TOP"];
      if (handle === "bottom-left") return ["LEFT", "BOTTOM"];
      if (handle === "bottom-right") return ["RIGHT", "BOTTOM"];
      if (handle === "top") return ["TOP"];
      if (handle === "right") return ["RIGHT"];
      if (handle === "bottom") return ["BOTTOM"];
      if (handle === "left") return ["LEFT"];
      return [];
    }

    function findResizeTargetForDirection(root, panelInfo, direction) {
      if (!panelInfo || !Array.isArray(panelInfo.ancestors)) return null;
      const axis = axisForDirection(direction);
      const wantsBefore = isBeforeDirection(direction);
      for (let i = 1; i < panelInfo.ancestors.length; i += 1) {
        const container = panelInfo.ancestors[i];
        const childSubtree = panelInfo.ancestors[i - 1];
        if (!container || container.type !== "container" || !childSubtree) continue;
        if (container.axis !== axis) continue;
        const idx = container.children.findIndex((child) => child.id === childSubtree.id);
        if (idx === -1) continue;
        if (wantsBefore && idx > 0) {
          return {
            containerId: container.id,
            movingChildId: childSubtree.id,
            neighborChildId: container.children[idx - 1].id
          };
        }
        if (!wantsBefore && idx < container.children.length - 1) {
          return {
            containerId: container.id,
            movingChildId: childSubtree.id,
            neighborChildId: container.children[idx + 1].id
          };
        }
      }
      return null;
    }

    function getContainerSpanPx(containerId, axis) {
      const containerEl = workspaceEl.querySelector(`.container[data-node-id="${containerId}"]`);
      if (!containerEl) return 0;
      const bounds = containerEl.getBoundingClientRect();
      return axis === "column" ? bounds.width : bounds.height;
    }

    function getMinSizePxForAxis(axis) {
      return axis === "column" ? config.minBoxWidthPx : config.minBoxHeightPx;
    }

    function buildResizePlanForDirection(root, panelInfo, direction) {
      const target = findResizeTargetForDirection(root, panelInfo, direction);
      if (!target) return null;
      const axis = axisForDirection(direction);
      const containerFound = findNodeById(root, target.containerId);
      if (!containerFound || containerFound.node.type !== "container") return null;
      const movingIdx = containerFound.node.children.findIndex((child) => child.id === target.movingChildId);
      const neighborIdx = containerFound.node.children.findIndex((child) => child.id === target.neighborChildId);
      if (movingIdx === -1 || neighborIdx === -1) return null;

      const containerSpanPx = getContainerSpanPx(target.containerId, axis);
      if (!(containerSpanPx > 0)) return null;

      const startMovingRatio = containerFound.node.sizes[movingIdx] || 0;
      const startNeighborRatio = containerFound.node.sizes[neighborIdx] || 0;
      const pairPx = (startMovingRatio + startNeighborRatio) * containerSpanPx;
      const minSizePx = getMinSizePxForAxis(axis);
      if (!(pairPx > minSizePx * 2)) return null;

      const maxStepsByMin = Math.max(1, Math.floor(pairPx / minSizePx));
      const snappedSteps = Math.max(1, Math.min(config.resizeSnapLevels, maxStepsByMin));
      const snapUnitPx = pairPx / snappedSteps;

      return {
        direction,
        axis,
        containerId: target.containerId,
        movingChildId: target.movingChildId,
        neighborChildId: target.neighborChildId,
        containerSpanPx,
        minSizePx,
        startMovingRatio,
        startNeighborRatio,
        snapUnitPx
      };
    }

    function applyResizePlan(nextRoot, plan, deltaX, deltaY) {
      const containerFound = findNodeById(nextRoot, plan.containerId);
      if (!containerFound || containerFound.node.type !== "container") return false;
      const movingIdx = containerFound.node.children.findIndex((child) => child.id === plan.movingChildId);
      const neighborIdx = containerFound.node.children.findIndex((child) => child.id === plan.neighborChildId);
      if (movingIdx === -1 || neighborIdx === -1) return false;

      const rawDeltaPx = plan.axis === "column" ? deltaX : deltaY;
      const signedDeltaPx = (plan.direction === "RIGHT" || plan.direction === "BOTTOM")
        ? rawDeltaPx
        : -rawDeltaPx;

      const movingStartPx = plan.startMovingRatio * plan.containerSpanPx;
      const pairPx = (plan.startMovingRatio + plan.startNeighborRatio) * plan.containerSpanPx;
      const minPx = plan.minSizePx;
      const maxPx = pairPx - minPx;
      if (!(maxPx > minPx)) return false;

      let movingPx = movingStartPx + signedDeltaPx;
      movingPx = Math.max(minPx, Math.min(maxPx, movingPx));
      movingPx = Math.round(movingPx / plan.snapUnitPx) * plan.snapUnitPx;
      movingPx = Math.max(minPx, Math.min(maxPx, movingPx));

      const newMovingRatio = movingPx / plan.containerSpanPx;
      const newNeighborRatio = (pairPx - movingPx) / plan.containerSpanPx;
      const oldMovingRatio = containerFound.node.sizes[movingIdx];
      const oldNeighborRatio = containerFound.node.sizes[neighborIdx];

      if (Math.abs(newMovingRatio - oldMovingRatio) < 1e-5
          && Math.abs(newNeighborRatio - oldNeighborRatio) < 1e-5) {
        return false;
      }

      containerFound.node.sizes[movingIdx] = newMovingRatio;
      containerFound.node.sizes[neighborIdx] = newNeighborRatio;
      return true;
    }

    function clearResizeSessionUI() {
      workspaceEl.classList.remove("resizing-layout");
    }

    function setGapHoverAxis(axis) {
      const nextAxis = axis || null;
      if (gapHoverAxis === nextAxis) return;
      gapHoverAxis = nextAxis;
      if (!nextAxis) {
        delete workspaceEl.dataset.gapResizeAxis;
        return;
      }
      workspaceEl.dataset.gapResizeAxis = nextAxis;
    }

    function pickPanelIdForEdge(childWrap, edge) {
      const panels = Array.from(childWrap.querySelectorAll(".panel[data-panel-id]"));
      if (panels.length === 0) return null;
      let bestPanel = null;
      let bestMetric = null;
      for (const panelEl of panels) {
        const rect = panelEl.getBoundingClientRect();
        let metric = 0;
        if (edge === "right") metric = rect.right;
        else if (edge === "left") metric = rect.left;
        else if (edge === "top") metric = rect.top;
        else metric = rect.bottom;
        if (!bestPanel) {
          bestPanel = panelEl;
          bestMetric = metric;
          continue;
        }
        const isBetter = (edge === "right" || edge === "bottom")
          ? metric > bestMetric
          : metric < bestMetric;
        if (isBetter) {
          bestPanel = panelEl;
          bestMetric = metric;
        }
      }
      return bestPanel ? bestPanel.dataset.panelId : null;
    }

    function findGapResizeCandidateAtPoint(point) {
      const containers = workspaceEl.querySelectorAll(".container[data-node-id]");
      const slop = Math.max(6, config.betweenSiblingHitSlopPx || 0);
      let best = null;
      for (const containerEl of containers) {
        const containerId = containerEl.dataset.nodeId;
        const childEls = Array.from(containerEl.children).filter((el) => el.classList.contains("child"));
        if (childEls.length < 2) continue;
        const isColumn = containerEl.classList.contains("column");
        const axis = isColumn ? "column" : "row";
        for (let i = 0; i < childEls.length - 1; i += 1) {
          const leftOrTop = childEls[i].getBoundingClientRect();
          const rightOrBottom = childEls[i + 1].getBoundingClientRect();
          if (isColumn) {
            const overlapTop = Math.max(leftOrTop.top, rightOrBottom.top);
            const overlapBottom = Math.min(leftOrTop.bottom, rightOrBottom.bottom);
            if (overlapBottom <= overlapTop) continue;
            const boundaryX = (leftOrTop.right + rightOrBottom.left) / 2;
            const withinX = Math.abs(point.x - boundaryX) <= slop;
            const withinY = point.y >= overlapTop && point.y <= overlapBottom;
            if (!withinX || !withinY) continue;
            const distance = Math.abs(point.x - boundaryX);
            if (!best || distance < best.distance) {
              const panelId = pickPanelIdForEdge(childEls[i], "right");
              if (!panelId) continue;
              best = {
                distance,
                axis,
                panelId,
                handle: "right"
              };
            }
          } else {
            const overlapLeft = Math.max(leftOrTop.left, rightOrBottom.left);
            const overlapRight = Math.min(leftOrTop.right, rightOrBottom.right);
            if (overlapRight <= overlapLeft) continue;
            const boundaryY = (leftOrTop.bottom + rightOrBottom.top) / 2;
            const withinY = Math.abs(point.y - boundaryY) <= slop;
            const withinX = point.x >= overlapLeft && point.x <= overlapRight;
            if (!withinX || !withinY) continue;
            const distance = Math.abs(point.y - boundaryY);
            if (!best || distance < best.distance) {
              const panelId = pickPanelIdForEdge(childEls[i], "bottom");
              if (!panelId) continue;
              best = {
                distance,
                axis,
                panelId,
                handle: "bottom"
              };
            }
          }
        }
      }
      return best;
    }

    function startResizeSession(panelId, handle, pointerId, point) {
      if (getDragCtx()) {
        statusEl.textContent = "Finish the current drag before resizing.";
        return;
      }

      const root = getRoot();
      const panelInfoMap = buildPanelInfoMap(root);
      const panelInfo = panelInfoMap.get(panelId);
      if (!panelInfo) return;
      const directions = getResizeDirectionsForHandle(handle);
      const plans = directions
        .map((direction) => buildResizePlanForDirection(root, panelInfo, direction))
        .filter(Boolean);

      if (plans.length === 0) {
        statusEl.textContent = "No adjacent resize boundary for that handle.";
        return;
      }

      setActivePanelId(panelId);
      resizeSession = {
        pointerId,
        startPoint: { ...point },
        baseRoot: cloneNode(root),
        plans
      };
      workspaceEl.classList.add("resizing-layout");
      statusEl.textContent = "Resizing with snapped steps. Release to commit.";
    }

    function startGapResizeSession(candidate, pointerId, point) {
      if (!candidate || !candidate.panelId || !candidate.handle) return;
      startResizeSession(candidate.panelId, candidate.handle, pointerId, point);
      if (!resizeSession) return;
      setGapHoverAxis(null);
    }

    function finishResizeSession(shouldCommit) {
      if (!resizeSession) return;
      const session = resizeSession;
      resizeSession = null;
      clearResizeSessionUI();
      if (shouldCommit) {
        statusEl.textContent = "Resize committed.";
        renderAndPersist();
        return;
      }
      setRoot(cloneNode(session.baseRoot));
      statusEl.textContent = "Resize canceled.";
      renderWithoutPersist();
    }

    function onResizeHandlePointerDown(e, panelId, handle) {
      if (e.button !== 0 || !e.isPrimary) return;
      e.preventDefault();
      e.stopPropagation();
      startResizeSession(panelId, handle, e.pointerId, { x: e.clientX, y: e.clientY });
    }

    function onWorkspacePointerDown(e) {
      if (resizeSession || getDragCtx()) return;
      if (e.button !== 0 || !e.isPrimary) return;
      if (e.target.closest(".resize-handle")) return;
      if (e.target.closest(".panel[data-panel-id]")) return;
      const point = { x: e.clientX, y: e.clientY };
      const candidate = findGapResizeCandidateAtPoint(point);
      if (!candidate) return;
      e.preventDefault();
      startGapResizeSession(candidate, e.pointerId, point);
    }

    function onResizePointerMove(e) {
      if (!resizeSession) {
        if (getDragCtx()) {
          setGapHoverAxis(null);
          return;
        }
        const point = { x: e.clientX, y: e.clientY };
        const candidate = findGapResizeCandidateAtPoint(point);
        setGapHoverAxis(candidate ? candidate.axis : null);
        return;
      }
      if (e.pointerId !== resizeSession.pointerId) return;
      e.preventDefault();
      const deltaX = e.clientX - resizeSession.startPoint.x;
      const deltaY = e.clientY - resizeSession.startPoint.y;

      const nextRoot = cloneNode(resizeSession.baseRoot);
      let anyChange = false;
      for (const plan of resizeSession.plans) {
        anyChange = applyResizePlan(nextRoot, plan, deltaX, deltaY) || anyChange;
      }

      setRoot(nextRoot);
      renderWithoutPersist();
      statusEl.textContent = anyChange
        ? "Resizing with snapped steps. Release to commit."
        : "Resize snapped to current level (move farther to reach next step).";
    }

    function onResizePointerUp(e) {
      if (!resizeSession || e.pointerId !== resizeSession.pointerId) return;
      e.preventDefault();
      finishResizeSession(true);
    }

    function onResizePointerCancel(e) {
      if (!resizeSession || e.pointerId !== resizeSession.pointerId) return;
      finishResizeSession(false);
    }

    function cancelActiveResize() {
      setGapHoverAxis(null);
      finishResizeSession(false);
    }

    return {
      onResizeHandlePointerDown,
      onWorkspacePointerDown,
      onResizePointerMove,
      onResizePointerUp,
      onResizePointerCancel,
      cancelActiveResize
    };
  }

  global.ResizeController = {
    create
  };
})(window);
