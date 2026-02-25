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

  function getDirectionalBandPolygon(bounds, layer, totalLayers, direction) {
    if (layer < 1 || totalLayers < 1) return [];
    const ring = 1 / totalLayers;
    const inner = (layer - 1) * ring;
    const outer = layer * ring;
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
    const cx = bounds.left + bounds.width / 2;
    const cy = bounds.top + bounds.height / 2;
    const halfW = bounds.width / 2;
    const halfH = bounds.height / 2;
    const xOuterLeft = cx - outer * halfW;
    const xOuterRight = cx + outer * halfW;
    const yOuterTop = cy - outer * halfH;
    const yOuterBottom = cy + outer * halfH;
    const xInnerLeft = cx - inner * halfW;
    const xInnerRight = cx + inner * halfW;
    const yInnerTop = cy - inner * halfH;
    const yInnerBottom = cy + inner * halfH;

    if (direction === "TOP" && yInnerTop > yOuterTop) {
      return [
        { x: xOuterLeft, y: yOuterTop },
        { x: xOuterRight, y: yOuterTop },
        { x: xOuterRight, y: yInnerTop },
        { x: xOuterLeft, y: yInnerTop }
      ];
    }
    if (direction === "BOTTOM" && yOuterBottom > yInnerBottom) {
      return [
        { x: xOuterLeft, y: yInnerBottom },
        { x: xOuterRight, y: yInnerBottom },
        { x: xOuterRight, y: yOuterBottom },
        { x: xOuterLeft, y: yOuterBottom }
      ];
    }
    if (direction === "LEFT" && xInnerLeft > xOuterLeft && yInnerBottom > yInnerTop) {
      return [
        { x: xOuterLeft, y: yInnerTop },
        { x: xInnerLeft, y: yInnerTop },
        { x: xInnerLeft, y: yInnerBottom },
        { x: xOuterLeft, y: yInnerBottom }
      ];
    }
    if (direction === "RIGHT" && xOuterRight > xInnerRight && yInnerBottom > yInnerTop) {
      return [
        { x: xInnerRight, y: yInnerTop },
        { x: xOuterRight, y: yInnerTop },
        { x: xOuterRight, y: yInnerBottom },
        { x: xInnerRight, y: yInnerBottom }
      ];
    }
    return [];
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
      getNodeElementById
    } = deps;

    function getInteractionBounds(panelBounds, tabsBounds) {
      if (!tabsBounds) return panelBounds;
      const panelBottom = panelBounds.top + panelBounds.height;
      const maxTop = Math.min(panelBottom, Math.max(panelBounds.top, tabsBounds.top + tabsBounds.height));
      const nextHeight = panelBottom - maxTop;
      if (nextHeight < config.minBandPx * 2) return panelBounds;
      return {
        left: panelBounds.left,
        top: maxTop,
        width: panelBounds.width,
        height: nextHeight
      };
    }

    function resolveDirectionalZone(info, panelBounds, layer, direction) {
      if (layer === 1) {
        if (panelBounds.width < config.minBoxWidthPx || panelBounds.height < config.minBoxHeightPx) {
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
      if (ancestorBounds.width < config.minBoxWidthPx || ancestorBounds.height < config.minBoxHeightPx) {
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

      return {
        layer,
        direction,
        type: "WRAP",
        targetId: ancestor.id,
        reason: `Layer ${layer} perpendicular to ancestor axis (${ancestor.axis})`
      };
    }

    function buildHitZoneDescriptors(panelEl, info) {
      const panelBounds = panelEl.getBoundingClientRect();
      const descriptors = [];

      const tabsEl = panelEl.querySelector(".tabs");
      if (tabsEl && config.allowTabStripStackZone) {
        const tabsBounds = tabsEl.getBoundingClientRect();
        descriptors.push({
          key: "stack-tabs",
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

      const centerRect = getCenterRect(panelBounds, config);
      descriptors.push({
        key: "stack-center",
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

      const totalLayers = getEffectiveLayerCount(panelBounds, info.depth, config);
      const directions = ["TOP", "BOTTOM", "LEFT", "RIGHT"];
      for (let layer = 1; layer <= totalLayers; layer += 1) {
        for (const direction of directions) {
          const poly = getDirectionalBandPolygon(panelBounds, layer, totalLayers, direction);
          if (!poly || poly.length < 3) continue;
          const zone = resolveDirectionalZone(info, panelBounds, layer, direction);
          descriptors.push({
            key: `layer-${layer}-${direction}`,
            layer,
            direction,
            geometry: {
              kind: "polygon",
              bounds: panelBounds,
              points: poly,
              clipPath: polygonToClipPath(panelBounds, poly)
            },
            zone,
            hit: (x, y) => pointInPolygon(x, y, poly)
          });
        }
      }

      return descriptors;
    }

    function buildDisplayZoneDescriptors(panelEl, info) {
      const panelBounds = panelEl.getBoundingClientRect();
      const descriptors = [];
      const tabsEl = panelEl.querySelector(".tabs");
      const tabsBounds = tabsEl ? tabsEl.getBoundingClientRect() : null;

      if (tabsBounds && config.allowTabStripStackZone) {
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
          }
        });
      }

      const interactionBounds = getInteractionBounds(panelBounds, tabsBounds);
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
        }
      });

      const directionalStartRatio = clamp(config.centerFraction, 0, 0.95);
      const totalLayers = getEffectiveLayerCount(interactionBounds, info.depth, config);
      const directions = ["TOP", "BOTTOM", "LEFT", "RIGHT"];
      for (let layer = 1; layer <= totalLayers; layer += 1) {
        for (const direction of directions) {
          const poly = getDisplayDirectionalBandPolygon(
            interactionBounds,
            layer,
            totalLayers,
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
            zone: resolveDirectionalZone(info, panelBounds, layer, direction)
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

    function zonesMatch(a, b) {
      if (!a || !b) return false;
      return a.layer === b.layer
        && a.direction === b.direction
        && a.type === b.type
        && a.panelId === b.panelId
        && a.targetId === b.targetId
        && a.insertIndex === b.insertIndex;
    }

    function hitTestZone(panelEl, panelInfo, x, y) {
      const descriptors = buildHitZoneDescriptors(panelEl, panelInfo);
      const hit = findZoneAtPoint(descriptors, x, y);
      return hit ? hit.zone : null;
    }

    function drawZonesForHoveredPanel(panelEl, info, selectedZone) {
      const overlay = document.getElementById("workspaceOverlay");
      if (!overlay) return;
      overlay.innerHTML = "";
      workspaceEl.querySelectorAll(".panel.drag-hover").forEach((p) => p.classList.remove("drag-hover"));
      panelEl.classList.add("drag-hover");
      const hasSelection = !!selectedZone;

      const overlayRect = overlay.getBoundingClientRect();
      const descriptors = buildDisplayZoneDescriptors(panelEl, info);
      for (const descriptor of descriptors) {
        const { geometry, zone } = descriptor;
        const zoneEl = document.createElement("div");
        zoneEl.className = zone.layer === 0 ? "zone center-guide" : "zone";

        if (geometry.kind === "rect") {
          zoneEl.style.left = `${geometry.bounds.left - overlayRect.left}px`;
          zoneEl.style.top = `${geometry.bounds.top - overlayRect.top}px`;
          zoneEl.style.width = `${geometry.bounds.width}px`;
          zoneEl.style.height = `${geometry.bounds.height}px`;
          zoneEl.style.opacity = "0.68";
        } else {
          zoneEl.style.left = `${geometry.bounds.left - overlayRect.left}px`;
          zoneEl.style.top = `${geometry.bounds.top - overlayRect.top}px`;
          zoneEl.style.width = `${geometry.bounds.width}px`;
          zoneEl.style.height = `${geometry.bounds.height}px`;
          zoneEl.style.clipPath = geometry.clipPath;
          zoneEl.style.opacity = "0.62";
        }

        zoneEl.style.background = actionColors[zone.type] || actionColors.INVALID;
        const isSelected = selectedZone && zonesMatch(zone, selectedZone);
        if (isSelected) {
          zoneEl.classList.add("selected");
        } else if (hasSelection) {
          zoneEl.classList.add("dimmed");
        }
        overlay.appendChild(zoneEl);
      }
    }

    return {
      hitTestZone,
      drawZonesForHoveredPanel
    };
  }

  global.DropZones = {
    create
  };
})(window);
