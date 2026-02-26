export function createAnimations(workspaceEl, { dropTransitionMs, previewTransitionMs }) {

  function clearTransitionStyles(el) {
    el.style.transition = "";
    el.style.transform = "";
    el.style.transformOrigin = "";
    el.style.opacity = "";
    el.style.willChange = "";
  }

  function animatePanelTransition(containerEl, previousRects, transitionMs, isPreview, enteredPanelId) {
    if (!previousRects || previousRects.size === 0) return;
    const panelEls = Array.from(containerEl.querySelectorAll(".panel[data-panel-id]"));
    if (panelEls.length === 0) return;

    const movingPanels = [];

    for (const panelEl of panelEls) {
      const panelId = panelEl.dataset.panelId;
      if (!panelId) continue;
      const oldRect = previousRects.get(panelId);
      const newRect = panelEl.getBoundingClientRect();

      if (!oldRect) {
        if (isPreview) {
          panelEl.style.opacity = "0.55";
          panelEl.style.transform = "scale(0.92)";
          panelEl.style.transition = "none";
          panelEl.style.willChange = "transform, opacity";
          movingPanels.push(panelEl);
        } else if (enteredPanelId && panelId === enteredPanelId) {
          panelEl.classList.add("drop-panel-enter");
          setTimeout(() => panelEl.classList.remove("drop-panel-enter"), transitionMs + 30);
        }
        continue;
      }

      if (newRect.width <= 0 || newRect.height <= 0) continue;
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;
      const sx = oldRect.width / newRect.width;
      const sy = oldRect.height / newRect.height;
      if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5 && Math.abs(1 - sx) <= 0.01 && Math.abs(1 - sy) <= 0.01) continue;

      clearTransitionStyles(panelEl);
      panelEl.style.transition = "none";
      panelEl.style.transformOrigin = "top left";
      panelEl.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      panelEl.style.willChange = isPreview ? "transform, opacity" : "transform";
      movingPanels.push(panelEl);
    }

    if (movingPanels.length === 0) return;

    requestAnimationFrame(() => {
      for (const panelEl of movingPanels) {
        panelEl.style.transition = isPreview
          ? `transform ${transitionMs}ms cubic-bezier(0.2, 0.78, 0.18, 1), opacity ${transitionMs}ms linear`
          : `transform ${transitionMs}ms cubic-bezier(0.2, 0.78, 0.18, 1)`;
        panelEl.style.transform = "translate(0px, 0px) scale(1, 1)";
        if (isPreview) panelEl.style.opacity = "1";
      }
    });

    setTimeout(() => {
      for (const panelEl of movingPanels) clearTransitionStyles(panelEl);
    }, transitionMs + 40);
  }

  return {
    animateDropTransition(previousRects, enteredPanelId = null) {
      animatePanelTransition(workspaceEl, previousRects, dropTransitionMs, false, enteredPanelId);
    },
    animatePreviewTransition(previewLayer, sourceRects) {
      if (!previewLayer || !sourceRects || sourceRects.size === 0) return;
      animatePanelTransition(previewLayer, sourceRects, previewTransitionMs, true, null);
    }
  };
}
