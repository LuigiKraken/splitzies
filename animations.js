(function attachAnimations(global) {
  "use strict";

  function create({ workspaceEl, dropTransitionMs, previewTransitionMs }) {

    function clearTransitionStyles(panelEl) {
      panelEl.style.transition = "";
      panelEl.style.transform = "";
      panelEl.style.transformOrigin = "";
      panelEl.style.opacity = "";
      panelEl.style.willChange = "";
    }

    // Shared FLIP animation core used by both drop and preview transitions.
    // containerEl  - element whose .panel children to animate
    // previousRects - Map of panelId -> rect captured before the DOM change
    // transitionMs  - duration
    // isPreview    - true = preview layer behaviour (fade-in new panels, animate opacity)
    // enteredPanelId - (drop only) id of newly created panel to flash-enter
    function animatePanelTransition(containerEl, previousRects, transitionMs, isPreview, enteredPanelId) {
      if (!previousRects || previousRects.size === 0) return;
      const panelEls = Array.from(containerEl.querySelectorAll(".panel[data-panel-id]"));
      if (panelEls.length === 0) return;

      const movingPanels = [];
      const epsilonPx = 0.5;

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
            window.setTimeout(() => panelEl.classList.remove("drop-panel-enter"), transitionMs + 30);
          }
          continue;
        }

        if (newRect.width <= 0 || newRect.height <= 0) continue;

        const dx = oldRect.left - newRect.left;
        const dy = oldRect.top - newRect.top;
        const sx = oldRect.width / newRect.width;
        const sy = oldRect.height / newRect.height;
        if (Math.abs(dx) <= epsilonPx && Math.abs(dy) <= epsilonPx
            && Math.abs(1 - sx) <= 0.01 && Math.abs(1 - sy) <= 0.01) continue;

        clearTransitionStyles(panelEl);
        panelEl.style.transition = "none";
        panelEl.style.transformOrigin = "top left";
        panelEl.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
        panelEl.style.willChange = isPreview ? "transform, opacity" : "transform";
        movingPanels.push(panelEl);
      }

      if (movingPanels.length === 0) return;

      window.requestAnimationFrame(() => {
        for (const panelEl of movingPanels) {
          panelEl.style.transition = isPreview
            ? `transform ${transitionMs}ms cubic-bezier(0.2, 0.78, 0.18, 1), opacity ${transitionMs}ms linear`
            : `transform ${transitionMs}ms cubic-bezier(0.2, 0.78, 0.18, 1)`;
          panelEl.style.transform = "translate(0px, 0px) scale(1, 1)";
          if (isPreview) panelEl.style.opacity = "1";
        }
      });

      window.setTimeout(() => {
        for (const panelEl of movingPanels) clearTransitionStyles(panelEl);
      }, transitionMs + 40);
    }

    function animateDropTransition(previousRects, enteredPanelId = null) {
      animatePanelTransition(workspaceEl, previousRects, dropTransitionMs, false, enteredPanelId);
    }

    function animatePreviewTransition(previewLayer, sourceRects) {
      if (!previewLayer || !sourceRects || sourceRects.size === 0) return;
      animatePanelTransition(previewLayer, sourceRects, previewTransitionMs, true, null);
    }

    return { animateDropTransition, animatePreviewTransition };
  }

  global.Animations = { create };
})(window);
