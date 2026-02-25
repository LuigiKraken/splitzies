(function attachDropZones(global) {
  "use strict";

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function pointInRect(x, y, r) {
    return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
  }

  function pointInPolygon(x, y, poly) {
    if (!poly || poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const xi = poly[i].x;
      const yi = poly[i].y;
      const xj = poly[j].x;
      const yj = poly[j].y;
      const intersects = ((yi > y) !== (yj > y))
        && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-8) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function getCenterRect(bounds, config) {
    const w = bounds.width * config.centerFraction;
    const h = bounds.height * config.centerFraction;
    return {
      left: bounds.left + (bounds.width - w) / 2,
      top: bounds.top + (bounds.height - h) / 2,
      width: w,
      height: h
    };
  }

  function getEffectiveLayerCount(bounds, depth, config) {
    const directionalLayerCount = Math.min(depth, config.maxDepth) + 1;
    const maxByPx = Math.floor(Math.min(bounds.width, bounds.height) / (2 * config.minBandPx));
    return Math.max(1, Math.min(directionalLayerCount, maxByPx || 1));
  }

  function clipPolygon(poly, isInside, intersect) {
    if (!poly.length) return [];
    const out = [];
    let prev = poly[poly.length - 1];
    let prevInside = isInside(prev);
    for (const curr of poly) {
      const currInside = isInside(curr);
      if (currInside) {
        if (!prevInside) out.push(intersect(prev, curr));
        out.push(curr);
      } else if (prevInside) {
        out.push(intersect(prev, curr));
      }
      prev = curr;
      prevInside = currInside;
    }
    return out;
  }

  function intersectSegmentWithVertical(a, b, xLine) {
    const dx = b.x - a.x;
    if (Math.abs(dx) < 1e-8) return { x: xLine, y: a.y };
    const t = (xLine - a.x) / dx;
    return { x: xLine, y: a.y + (b.y - a.y) * t };
  }

  function intersectSegmentWithHorizontal(a, b, yLine) {
    const dy = b.y - a.y;
    if (Math.abs(dy) < 1e-8) return { x: a.x, y: yLine };
    const t = (yLine - a.y) / dy;
    return { x: a.x + (b.x - a.x) * t, y: yLine };
  }

  function getDirectionalBasePolygon(bounds, direction) {
    const cx = bounds.left + bounds.width / 2;
    const cy = bounds.top + bounds.height / 2;
    const left = bounds.left;
    const right = bounds.left + bounds.width;
    const top = bounds.top;
    const bottom = bounds.top + bounds.height;

    if (direction === "TOP") {
      return [{ x: left, y: top }, { x: right, y: top }, { x: cx, y: cy }];
    }
    if (direction === "BOTTOM") {
      return [{ x: right, y: bottom }, { x: left, y: bottom }, { x: cx, y: cy }];
    }
    if (direction === "LEFT") {
      return [{ x: left, y: bottom }, { x: left, y: top }, { x: cx, y: cy }];
    }
    return [{ x: right, y: top }, { x: right, y: bottom }, { x: cx, y: cy }];
  }

  function getDirectionalBandPolygonByRatio(bounds, direction, innerRatio, outerRatio) {
    const inner = clamp(innerRatio, 0, 1);
    const outer = clamp(outerRatio, 0, 1);
    if (outer <= inner) return [];
    const cx = bounds.left + bounds.width / 2;
    const cy = bounds.top + bounds.height / 2;
    const halfW = bounds.width / 2;
    const halfH = bounds.height / 2;

    let poly = getDirectionalBasePolygon(bounds, direction);
    if (!poly.length) return poly;

    if (direction === "LEFT") {
      const xMin = cx - outer * halfW;
      const xMax = cx - inner * halfW;
      poly = clipPolygon(
        poly,
        (p) => p.x >= xMin,
        (a, b) => intersectSegmentWithVertical(a, b, xMin)
      );
      poly = clipPolygon(
        poly,
        (p) => p.x <= xMax,
        (a, b) => intersectSegmentWithVertical(a, b, xMax)
      );
    } else if (direction === "RIGHT") {
      const xMin = cx + inner * halfW;
      const xMax = cx + outer * halfW;
      poly = clipPolygon(
        poly,
        (p) => p.x >= xMin,
        (a, b) => intersectSegmentWithVertical(a, b, xMin)
      );
      poly = clipPolygon(
        poly,
        (p) => p.x <= xMax,
        (a, b) => intersectSegmentWithVertical(a, b, xMax)
      );
    } else if (direction === "TOP") {
      const yMin = cy - outer * halfH;
      const yMax = cy - inner * halfH;
      poly = clipPolygon(
        poly,
        (p) => p.y >= yMin,
        (a, b) => intersectSegmentWithHorizontal(a, b, yMin)
      );
      poly = clipPolygon(
        poly,
        (p) => p.y <= yMax,
        (a, b) => intersectSegmentWithHorizontal(a, b, yMax)
      );
    } else {
      const yMin = cy + inner * halfH;
      const yMax = cy + outer * halfH;
      poly = clipPolygon(
        poly,
        (p) => p.y >= yMin,
        (a, b) => intersectSegmentWithHorizontal(a, b, yMin)
      );
      poly = clipPolygon(
        poly,
        (p) => p.y <= yMax,
        (a, b) => intersectSegmentWithHorizontal(a, b, yMax)
      );
    }

    return poly;
  }

  function getDisplayDirectionalBandPolygon(bounds, layer, totalLayers, direction, startRatio) {
    if (layer < 1 || totalLayers < 1) return [];
    const safeStart = clamp(startRatio, 0, 0.95);
    const ring = (1 - safeStart) / totalLayers;
    const inner = safeStart + (layer - 1) * ring;
    const outer = safeStart + layer * ring;
    return getDirectionalBandPolygonByRatio(bounds, direction, inner, outer);
  }

  function polygonToClipPath(bounds, poly) {
    if (!poly || poly.length < 3 || bounds.width <= 0 || bounds.height <= 0) return "";
    const pts = poly.map((p) => {
      const x = clamp(((p.x - bounds.left) / bounds.width) * 100, 0, 100);
      const y = clamp(((p.y - bounds.top) / bounds.height) * 100, 0, 100);
      return `${x}% ${y}%`;
    });
    return `polygon(${pts.join(", ")})`;
  }

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

    function zoneOutcomeKey(zone) {
      if (!zone || zone.type === "INVALID") return "INVALID";
      return [
        zone.type || "",
        zone.direction || "",
        zone.panelId || "",
        zone.targetId || "",
        Number.isFinite(zone.insertIndex) ? zone.insertIndex : ""
      ].join("|");
    }

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

    function canHostPanelWithinBounds(bounds) {
      return bounds.width >= config.minBoxWidthPx && bounds.height >= config.minBoxHeightPx;
    }

    function canSplitBoundsIntoSiblings(bounds, axis, siblingCount) {
      if (!bounds || siblingCount < 1) return false;
      if (!canHostPanelWithinBounds(bounds)) return false;
      if (axis === "column") {
        return (bounds.width / siblingCount) >= config.minBoxWidthPx;
      }
      return (bounds.height / siblingCount) >= config.minBoxHeightPx;
    }

    function resolveDirectionalZone(info, panelBounds, layer, direction) {
      if (layer === 1) {
        if (!canHostPanelWithinBounds(panelBounds)) {
          return {
            layer,
            direction,
            type: "INVALID",
            targetId: info.panel.id,
            reason: "Panel is smaller than configured minimum size."
          };
        }
        const splitAxis = axisForDirection(direction);
        if (!canAddSiblingToAxis(splitAxis, 2)) {
          return {
            layer,
            direction,
            type: "INVALID",
            targetId: info.panel.id,
            reason: `Max ${splitAxis === "column" ? "horizontal" : "vertical"} stack reached.`
          };
        }
        if (!canSplitBoundsIntoSiblings(panelBounds, splitAxis, 2)) {
          return {
            layer,
            direction,
            type: "INVALID",
            targetId: info.panel.id,
            reason: "Split would create panels smaller than configured minimum size."
          };
        }
        return {
          layer,
          direction,
          type: "SPLIT",
          panelId: info.panel.id,
          targetId: info.panel.id,
          reason: "Layer 1 directional split"
        };
      }

      const ancestorIndex = layer - 1;
      const ancestor = info.ancestors[ancestorIndex];
      const childSubtree = info.ancestors[ancestorIndex - 1];
      if (!ancestor || ancestor.type !== "container" || !childSubtree) {
        return {
          layer,
          direction,
          type: "INVALID",
          targetId: info.panel.id,
          reason: "No ancestor container available for this layer."
        };
      }

      const ancestorEl = getNodeElementById(ancestor.id);
      if (!ancestorEl) {
        return {
          layer,
          direction,
          type: "INVALID",
          targetId: ancestor.id,
          reason: "Ancestor element not found."
        };
      }
      const ancestorBounds = ancestorEl.getBoundingClientRect();
      if (!canHostPanelWithinBounds(ancestorBounds)) {
        return {
          layer,
          direction,
          type: "INVALID",
          targetId: ancestor.id,
          reason: "Ancestor area is smaller than configured minimum size."
        };
      }

      if (isAlongAxis(ancestor.axis, direction)) {
        const nextSiblingCount = ancestor.children.length + 1;
        if (!canAddSiblingToAxis(ancestor.axis, nextSiblingCount)) {
          return {
            layer,
            direction,
            type: "INVALID",
            targetId: ancestor.id,
            reason: `Max ${ancestor.axis === "column" ? "horizontal" : "vertical"} stack reached.`
          };
        }
        if (!canSplitBoundsIntoSiblings(ancestorBounds, ancestor.axis, nextSiblingCount)) {
          return {
            layer,
            direction,
            type: "INVALID",
            targetId: ancestor.id,
            reason: "Equalize would create panels smaller than configured minimum size."
          };
        }
        const childIdx = ancestor.children.findIndex((c) => c.id === childSubtree.id);
        if (childIdx === -1) {
          return {
            layer,
            direction,
            type: "INVALID",
            targetId: ancestor.id,
            reason: "Child subtree was not found in ancestor."
          };
        }
        const insertBefore = isBeforeDirection(direction);
        const insertIndex = insertBefore ? childIdx : childIdx + 1;
        return {
          layer,
          direction,
          type: "EQUALIZE",
          targetId: ancestor.id,
          childSubtreeId: childSubtree.id,
          insertIndex,
          reason: `Layer ${layer} along ancestor axis (${ancestor.axis})`
        };
      }

      const wrapAxis = axisForDirection(direction);
      if (!canAddSiblingToAxis(wrapAxis, 2)) {
        return {
          layer,
          direction,
          type: "INVALID",
          targetId: ancestor.id,
          reason: `Max ${wrapAxis === "column" ? "horizontal" : "vertical"} stack reached.`
        };
      }
      if (!canSplitBoundsIntoSiblings(ancestorBounds, wrapAxis, 2)) {
        return {
          layer,
          direction,
          type: "INVALID",
          targetId: ancestor.id,
          reason: "Wrap would create panels smaller than configured minimum size."
        };
      }

      return {
        layer,
        direction,
        type: "WRAP",
        targetId: ancestor.id,
        reason: `Layer ${layer} perpendicular to ancestor axis (${ancestor.axis})`
      };
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
          && panelBounds.height >= config.tabStripStackZoneMinHeightPx) {
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
      const matches = descriptors.filter((d) => d.hit(x, y));
      if (matches.length === 0) return null;
      matches.sort((a, b) => a.layer - b.layer);
      return matches[0];
    }

    function chooseBetterZoneCandidate(current, next) {
      if (!next) return current;
      if (!current) return next;
      const currentInvalid = current.zone.type === "INVALID";
      const nextInvalid = next.zone.type === "INVALID";
      if (currentInvalid !== nextInvalid) {
        return nextInvalid ? current : next;
      }
      if (next.zone.layer < current.zone.layer) {
        return next;
      }
      return current;
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

        for (let i = 0; i < childEls.length - 1; i += 1) {
          const a = childEls[i].getBoundingClientRect();
          const b = childEls[i + 1].getBoundingClientRect();
          const childNode = containerNode.children[i];
          const childPanelId = childNode && childNode.type === "panel" ? childNode.id : null;

          if (containerNode.axis === "column") {
            const overlapTop = Math.max(a.top, b.top);
            const overlapBottom = Math.min(a.bottom, b.bottom);
            if (overlapBottom <= overlapTop) continue;
            const boundary = (a.right + b.left) / 2;
            const minX = Math.min(a.right, b.left) - config.betweenSiblingHitSlopPx;
            const maxX = Math.max(a.right, b.left) + config.betweenSiblingHitSlopPx;
            descriptors.push({
              layer: 2,
              direction: "RIGHT",
              panelId: childPanelId,
              zone: {
                layer: 2,
                direction: "RIGHT",
                type: "EQUALIZE",
                targetId: containerNode.id,
                insertIndex: i + 1,
                reason: "Between sibling panels"
              },
              hit: (x, y) => x >= minX && x <= maxX && y >= overlapTop && y <= overlapBottom,
              distance: (x) => Math.abs(x - boundary)
            });
          } else {
            const overlapLeft = Math.max(a.left, b.left);
            const overlapRight = Math.min(a.right, b.right);
            if (overlapRight <= overlapLeft) continue;
            const boundary = (a.bottom + b.top) / 2;
            const minY = Math.min(a.bottom, b.top) - config.betweenSiblingHitSlopPx;
            const maxY = Math.max(a.bottom, b.top) + config.betweenSiblingHitSlopPx;
            descriptors.push({
              layer: 2,
              direction: "BOTTOM",
              panelId: childPanelId,
              zone: {
                layer: 2,
                direction: "BOTTOM",
                type: "EQUALIZE",
                targetId: containerNode.id,
                insertIndex: i + 1,
                reason: "Between sibling panels"
              },
              hit: (x, y) => y >= minY && y <= maxY && x >= overlapLeft && x <= overlapRight,
              distance: (_, y) => Math.abs(y - boundary)
            });
          }
        }
      }
      return descriptors;
    }

    function findBetweenSiblingsZoneAtPoint(x, y) {
      const descriptors = buildBetweenSiblingsDescriptors();
      let best = null;
      for (const descriptor of descriptors) {
        if (!descriptor.hit(x, y)) continue;
        const candidate = {
          panelId: descriptor.panelId,
          info: null,
          zone: descriptor.zone,
          metric: descriptor.distance(x, y)
        };
        if (!best || candidate.metric < best.metric) {
          best = candidate;
        }
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
        if (hoveredPanelId && hoveredPanelId === panelId) {
          panelEl.classList.add("drag-hover");
        }
        const descriptors = buildDisplayZoneDescriptors(panelEl, info);
        for (const descriptor of descriptors) {
          const { geometry, zone } = descriptor;
          const zoneEl = document.createElement("div");
          zoneEl.className = zone.layer === 0 ? "zone center-guide" : "zone";

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
      drawZonesForWorkspace(infoMap, selectedZone, info.panel.id);
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
