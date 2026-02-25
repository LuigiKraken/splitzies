(function attachDropZones(global) {
  "use strict";

  if (!global.ZoneGeometry) {
    throw new Error("Missing ZoneGeometry. Ensure geometry.js is loaded before dropZones.js.");
  }
  const {
    clamp,
    pointInRect,
    pointInPolygon,
    getCenterRect,
    getEffectiveLayerCount,
    getDisplayDirectionalBandPolygon,
    polygonToClipPath
  } = global.ZoneGeometry;

  function create(deps) {
    const {
      config,
      canAddSiblingToAxis,
      axisForDirection,
      isAlongAxis,
      isBeforeDirection,
      workspaceEl,
      actionColors,
      getNodeElementById,
      getRoot,
      findNodeById
    } = deps;
    const outcomePalette = [
      "rgba(239, 68, 68, 0.30)",
      "rgba(249, 115, 22, 0.30)",
      "rgba(234, 179, 8, 0.30)",
      "rgba(132, 204, 22, 0.30)",
      "rgba(34, 197, 94, 0.30)",
      "rgba(20, 184, 166, 0.30)",
      "rgba(14, 165, 233, 0.30)",
      "rgba(59, 130, 246, 0.30)",
      "rgba(99, 102, 241, 0.30)",
      "rgba(139, 92, 246, 0.30)",
      "rgba(168, 85, 247, 0.30)",
      "rgba(217, 70, 239, 0.30)",
      "rgba(236, 72, 153, 0.30)",
      "rgba(244, 63, 94, 0.30)",
      "rgba(251, 146, 60, 0.30)",
      "rgba(163, 230, 53, 0.30)",
      "rgba(45, 212, 191, 0.30)",
      "rgba(6, 182, 212, 0.30)",
      "rgba(56, 189, 248, 0.30)",
      "rgba(96, 165, 250, 0.30)",
      "rgba(129, 140, 248, 0.30)",
      "rgba(167, 139, 250, 0.30)",
      "rgba(192, 132, 252, 0.30)",
      "rgba(244, 114, 182, 0.30)"
    ];

    const zoneOutcomeKey = (zone) => {
      if (!zone || zone.type === "INVALID") return "INVALID";
      return [zone.type, zone.direction, zone.panelId, zone.targetId, Number.isFinite(zone.insertIndex) ? zone.insertIndex : ""].join("|");
    };

    function isDirectionalLayerReachable(info, ancestorIndex, direction) {
      if (!info || !Array.isArray(info.ancestors) || ancestorIndex <= 0) return true;
      const insertBefore = isBeforeDirection(direction);
      // Only intermediate along-axis containers gate reachability to deeper layers.
      // The target ancestor itself remains reachable even when the child is not at
      // the extreme edge (that allows valid "insert before/after this child").
      for (let i = 1; i < ancestorIndex; i += 1) {
        const container = info.ancestors[i];
        const childSubtree = info.ancestors[i - 1];
        if (!container || container.type !== "container" || !childSubtree) return false;
        if (!isAlongAxis(container.axis, direction)) continue;
        const childIdx = container.children.findIndex((c) => c.id === childSubtree.id);
        if (childIdx === -1) return false;
        if (insertBefore) {
          if (childIdx !== 0) return false;
        } else if (childIdx !== container.children.length - 1) {
          return false;
        }
      }
      return true;
    }

    function getReachableDirectionalLayerCount(info, totalLayers, direction) {
      let count = 0;
      for (let layer = 1; layer <= totalLayers; layer += 1) {
        if (!isDirectionalLayerReachable(info, layer - 1, direction)) break;
        count = layer;
      }
      return count;
    }

    const getWorkspaceBounds = () => workspaceEl.getBoundingClientRect();
    const getMinPanelWidthPx = () => Math.max(1, getWorkspaceBounds().width * config.minBoxWidthFraction);
    const getMinPanelHeightPx = () => Math.max(1, getWorkspaceBounds().height * config.minBoxHeightFraction);
    const getTabStripStackZoneMinHeightPx = () => Math.max(1, getWorkspaceBounds().height * config.tabStripStackZoneMinHeightFraction);
    const canHostPanelWithinBounds = (bounds) => bounds.width >= getMinPanelWidthPx() && bounds.height >= getMinPanelHeightPx();

    function canSplitBoundsIntoSiblings(bounds, axis, siblingCount) {
      if (!bounds || siblingCount < 1 || !canHostPanelWithinBounds(bounds)) return false;
      return axis === "column"
        ? (bounds.width / siblingCount) >= getMinPanelWidthPx()
        : (bounds.height / siblingCount) >= getMinPanelHeightPx();
    }

    function resolveDirectionalZone(info, panelBounds, layer, direction) {
      const invalid = (targetId, reason) => ({ layer, direction, type: "INVALID", targetId, reason });
      const stackMsg = (axis) => `Max ${axis === "column" ? "horizontal" : "vertical"} stack reached.`;

      if (layer === 1) {
        if (!canHostPanelWithinBounds(panelBounds)) {
          return invalid(info.panel.id, "Panel is smaller than configured minimum size.");
        }
        const splitAxis = axisForDirection(direction);
        if (!canAddSiblingToAxis(splitAxis, 2)) {
          return invalid(info.panel.id, stackMsg(splitAxis));
        }
        if (!canSplitBoundsIntoSiblings(panelBounds, splitAxis, 2)) {
          return invalid(info.panel.id, "Split would create panels smaller than configured minimum size.");
        }
        return { layer, direction, type: "SPLIT", panelId: info.panel.id, targetId: info.panel.id, reason: "Layer 1 directional split" };
      }

      const ancestorIndex = layer - 1;
      const ancestor = info.ancestors[ancestorIndex];
      const childSubtree = info.ancestors[ancestorIndex - 1];
      if (!ancestor || ancestor.type !== "container" || !childSubtree) {
        return invalid(info.panel.id, "No ancestor container available for this layer.");
      }

      const ancestorEl = getNodeElementById(ancestor.id);
      if (!ancestorEl) {
        return invalid(ancestor.id, "Ancestor element not found.");
      }
      const ancestorBounds = ancestorEl.getBoundingClientRect();
      if (!canHostPanelWithinBounds(ancestorBounds)) {
        return invalid(ancestor.id, "Ancestor area is smaller than configured minimum size.");
      }

      if (isAlongAxis(ancestor.axis, direction)) {
        const nextSiblingCount = ancestor.children.length + 1;
        if (!canAddSiblingToAxis(ancestor.axis, nextSiblingCount)) {
          return invalid(ancestor.id, stackMsg(ancestor.axis));
        }
        if (!canSplitBoundsIntoSiblings(ancestorBounds, ancestor.axis, nextSiblingCount)) {
          return invalid(ancestor.id, "Equalize would create panels smaller than configured minimum size.");
        }
        const childIdx = ancestor.children.findIndex((c) => c.id === childSubtree.id);
        if (childIdx === -1) {
          return invalid(ancestor.id, "Child subtree was not found in ancestor.");
        }
        const insertIndex = isBeforeDirection(direction) ? childIdx : childIdx + 1;
        return { layer, direction, type: "EQUALIZE", targetId: ancestor.id, childSubtreeId: childSubtree.id, insertIndex, reason: `Layer ${layer} along ancestor axis (${ancestor.axis})` };
      }

      const wrapAxis = axisForDirection(direction);
      if (!canAddSiblingToAxis(wrapAxis, 2)) {
        return invalid(ancestor.id, stackMsg(wrapAxis));
      }
      if (!canSplitBoundsIntoSiblings(ancestorBounds, wrapAxis, 2)) {
        return invalid(ancestor.id, "Wrap would create panels smaller than configured minimum size.");
      }
      return { layer, direction, type: "WRAP", targetId: ancestor.id, reason: `Layer ${layer} perpendicular to ancestor axis (${ancestor.axis})` };
    }

    function buildDisplayZoneDescriptors(panelEl, info) {
      const panelBounds = panelEl.getBoundingClientRect();
      const descriptors = [];
      const tabsEl = panelEl.querySelector(".tabs");
      let tabsBounds = null;
      if (tabsEl) {
        const tabEls = Array.from(tabsEl.querySelectorAll(".tab"));
        if (tabEls.length > 0) {
          const stripRect = tabsEl.getBoundingClientRect();
          let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
          let lastTabWidth = 0;
          for (const tabEl of tabEls) {
            const r = tabEl.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            left = Math.min(left, r.left);
            top = Math.min(top, r.top);
            right = Math.max(right, r.right);
            bottom = Math.max(bottom, r.bottom);
            lastTabWidth = r.width;
          }
          const extendedRight = Math.min(right + lastTabWidth * (2 / 3), stripRect.right);
          if (left < extendedRight && top < bottom) {
            tabsBounds = { left, top, width: extendedRight - left, height: bottom - top };
          }
        }
      }

      if (tabsBounds && config.allowTabStripStackZone
          && panelBounds.height >= getTabStripStackZoneMinHeightPx()) {
        descriptors.push({
          key: "display-stack-tabs",
          layer: 0,
          direction: null,
          geometry: { kind: "rect", bounds: tabsBounds },
          zone: {
            layer: 0,
            direction: null,
            type: "STACK",
            panelId: info.panel.id,
            targetId: info.panel.id,
            reason: "Tab strip zone"
          },
          hit: (x, y) => pointInRect(x, y, tabsBounds)
        });
      }

      // Zones are computed from the full panel rectangle. The tab strip is
      // treated as content and must not shrink the zone interaction surface.
      const interactionBounds = panelBounds;
      const centerRect = getCenterRect(interactionBounds, config);
      descriptors.push({
        key: "display-stack-center",
        layer: 0,
        direction: null,
        geometry: { kind: "rect", bounds: centerRect },
        zone: {
          layer: 0,
          direction: null,
          type: "STACK",
          panelId: info.panel.id,
          targetId: info.panel.id,
          reason: "Center zone"
        },
        hit: (x, y) => pointInRect(x, y, centerRect)
      });

      const directionalStartRatio = clamp(config.centerFraction, 0, 0.95);
      const totalLayers = getEffectiveLayerCount(interactionBounds, info.depth, config);
      const directions = ["TOP", "BOTTOM", "LEFT", "RIGHT"];
      for (const direction of directions) {
        const reachableLayerCount = getReachableDirectionalLayerCount(info, totalLayers, direction);
        for (let layer = 1; layer <= reachableLayerCount; layer += 1) {
          const poly = getDisplayDirectionalBandPolygon(
            interactionBounds,
            layer,
            reachableLayerCount,
            direction,
            directionalStartRatio
          );
          if (!poly || poly.length < 3) continue;
          descriptors.push({
            key: `display-layer-${layer}-${direction}`,
            layer,
            direction,
            geometry: {
              kind: "polygon",
              bounds: interactionBounds,
              points: poly,
              clipPath: polygonToClipPath(interactionBounds, poly)
            },
            zone: resolveDirectionalZone(info, panelBounds, layer, direction),
            hit: (x, y) => pointInPolygon(x, y, poly)
          });
        }
      }

      return descriptors;
    }

    function findZoneAtPoint(descriptors, x, y) {
      if (!descriptors || descriptors.length === 0) return null;
      const matches = descriptors.filter((d) => d.hit(x, y)).sort((a, b) => a.layer - b.layer);
      return matches[0] || null;
    }

    function chooseBetterZoneCandidate(current, next) {
      if (!next) return current;
      if (!current) return next;
      const [ci, ni] = [current.zone.type === "INVALID", next.zone.type === "INVALID"];
      if (ci !== ni) return ni ? current : next;
      return next.zone.layer < current.zone.layer ? next : current;
    }

    function buildBetweenSiblingsDescriptors() {
      if (!getRoot || !findNodeById) return [];
      const root = getRoot();
      const descriptors = [];
      const containerEls = workspaceEl.querySelectorAll(".container[data-node-id]");
      for (const containerEl of containerEls) {
        const containerId = containerEl.dataset.nodeId;
        const found = findNodeById(root, containerId);
        if (!found || found.node.type !== "container") continue;
        const containerNode = found.node;
        if (containerNode.children.length < 2) continue;
        const nextSiblingCount = containerNode.children.length + 1;
        if (!canAddSiblingToAxis(containerNode.axis, nextSiblingCount)) continue;
        const containerBounds = containerEl.getBoundingClientRect();
        if (!canSplitBoundsIntoSiblings(containerBounds, containerNode.axis, nextSiblingCount)) continue;

        const childEls = Array.from(containerEl.children).filter((el) => el.classList.contains("child"));
        if (childEls.length < 2) continue;

        const isHoriz = containerNode.axis === "column";
        const direction = isHoriz ? "RIGHT" : "BOTTOM";

        for (let i = 0; i < childEls.length - 1; i += 1) {
          const a = childEls[i].getBoundingClientRect();
          const b = childEls[i + 1].getBoundingClientRect();
          const childNode = containerNode.children[i];
          const childPanelId = childNode && childNode.type === "panel" ? childNode.id : null;

          const edgeA = isHoriz ? a.right : a.bottom;
          const edgeB = isHoriz ? b.left : b.top;
          const overlapMin = Math.max(isHoriz ? a.top : a.left, isHoriz ? b.top : b.left);
          const overlapMax = Math.min(isHoriz ? a.bottom : a.right, isHoriz ? b.bottom : b.right);
          if (overlapMax <= overlapMin) continue;

          const boundary = (edgeA + edgeB) / 2;
          const slopMin = Math.min(edgeA, edgeB) - config.betweenSiblingHitSlopPx;
          const slopMax = Math.max(edgeA, edgeB) + config.betweenSiblingHitSlopPx;
          descriptors.push({
            layer: 2,
            direction,
            panelId: childPanelId,
            zone: { layer: 2, direction, type: "EQUALIZE", targetId: containerNode.id, insertIndex: i + 1, reason: "Between sibling panels" },
            hit: isHoriz
              ? (x, y) => x >= slopMin && x <= slopMax && y >= overlapMin && y <= overlapMax
              : (x, y) => y >= slopMin && y <= slopMax && x >= overlapMin && x <= overlapMax,
            distance: isHoriz ? (x) => Math.abs(x - boundary) : (_, y) => Math.abs(y - boundary)
          });
        }
      }
      return descriptors;
    }

    function findBetweenSiblingsZoneAtPoint(x, y) {
      let best = null;
      for (const descriptor of buildBetweenSiblingsDescriptors()) {
        if (!descriptor.hit(x, y)) continue;
        const candidate = { panelId: descriptor.panelId, info: null, zone: descriptor.zone, metric: descriptor.distance(x, y) };
        if (!best || candidate.metric < best.metric) best = candidate;
      }
      return best;
    }

    function resolveHoverAtPoint(panelInfoMap, x, y) {
      const hovered = document.elementFromPoint(x, y);
      const hoveredPanelEl = hovered ? hovered.closest(".panel[data-panel-id]") : null;
      if (hoveredPanelEl && workspaceEl.contains(hoveredPanelEl)) {
        const panelId = hoveredPanelEl.dataset.panelId;
        const info = panelInfoMap.get(panelId);
        if (info) {
          const zone = hitTestZone(hoveredPanelEl, info, x, y);
          // Preserve default behavior: when hovering a panel, still return it even
          // if this exact point is in a no-op area so overlays remain visible.
          return { panelEl: hoveredPanelEl, panelId, info, zone };
        }
      }

      let best = null;
      for (const [panelId, info] of panelInfoMap.entries()) {
        const panelEl = workspaceEl.querySelector(`.panel[data-panel-id="${panelId}"]`);
        if (!panelEl) continue;
        const zone = hitTestZone(panelEl, info, x, y);
        if (!zone) continue;
        best = chooseBetterZoneCandidate(best, { panelEl, panelId, info, zone });
      }

      const betweenSibling = findBetweenSiblingsZoneAtPoint(x, y);
      if (betweenSibling) {
        const panelEl = betweenSibling.panelId
          ? workspaceEl.querySelector(`.panel[data-panel-id="${betweenSibling.panelId}"]`)
          : null;
        best = chooseBetterZoneCandidate(best, {
          panelEl,
          panelId: betweenSibling.panelId,
          info: null,
          zone: betweenSibling.zone
        });
      }

      return best;
    }

    function zonesMatch(a, b) {
      if (!a || !b) return false;
    return a.direction === b.direction
        && a.type === b.type
        && a.panelId === b.panelId
        && a.targetId === b.targetId
        && a.insertIndex === b.insertIndex;
    }

    function hitTestZone(panelEl, panelInfo, x, y) {
      const descriptors = buildDisplayZoneDescriptors(panelEl, panelInfo);
      const hit = findZoneAtPoint(descriptors, x, y);
      return hit ? hit.zone : null;
    }

    function drawZonesForWorkspace(panelInfoMap, selectedZone, hoveredPanelId = null, options = {}) {
      const overlay = document.getElementById("workspaceOverlay");
      if (!overlay) return;
      overlay.innerHTML = "";
      workspaceEl.querySelectorAll(".panel.drag-hover").forEach((p) => p.classList.remove("drag-hover"));
      const dimUnselected = options.dimUnselected !== false;
      const hasSelection = !!selectedZone && dimUnselected;
      const overlayRect = overlay.getBoundingClientRect();
      const outcomeColorMap = new Map();
      let nextOutcomeColorIndex = 0;

      function resolveZoneColor(zone) {
        if (!zone || zone.type === "INVALID") {
          return actionColors.INVALID;
        }
        const key = zoneOutcomeKey(zone);
        if (!outcomeColorMap.has(key)) {
          const paletteColor = outcomePalette[nextOutcomeColorIndex % outcomePalette.length];
          outcomeColorMap.set(key, paletteColor);
          nextOutcomeColorIndex += 1;
        }
        return outcomeColorMap.get(key);
      }

      for (const [panelId, info] of panelInfoMap.entries()) {
        const panelEl = workspaceEl.querySelector(`.panel[data-panel-id="${panelId}"]`);
        if (!panelEl) continue;
        const descriptors = buildDisplayZoneDescriptors(panelEl, info);
        for (const descriptor of descriptors) {
          const { geometry, zone } = descriptor;
          const zoneEl = document.createElement("div");
          zoneEl.className = "zone";

          zoneEl.style.left = `${geometry.bounds.left - overlayRect.left}px`;
          zoneEl.style.top = `${geometry.bounds.top - overlayRect.top}px`;
          zoneEl.style.width = `${geometry.bounds.width}px`;
          zoneEl.style.height = `${geometry.bounds.height}px`;
          if (geometry.kind === "polygon") {
            zoneEl.style.clipPath = geometry.clipPath;
            zoneEl.style.opacity = "0.62";
          } else {
            zoneEl.style.opacity = "0.68";
          }

          zoneEl.style.background = resolveZoneColor(zone);
          const isSelected = selectedZone && zonesMatch(zone, selectedZone);
          if (isSelected) {
            zoneEl.classList.add("selected");
          } else if (hasSelection) {
            zoneEl.classList.add("dimmed");
          }
          overlay.appendChild(zoneEl);
        }
      }
    }

    function drawZonesForHoveredPanel(panelEl, info, selectedZone) {
      const infoMap = new Map([[info.panel.id, info]]);
      drawZonesForWorkspace(infoMap, selectedZone);
    }

    return {
      hitTestZone,
      resolveHoverAtPoint,
      drawZonesForWorkspace,
      drawZonesForHoveredPanel
    };
  }

  global.DropZones = {
    create
  };
})(window);
