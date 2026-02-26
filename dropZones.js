import { axisForDirection, isAlongAxis, isBeforeDirection, findNodeById } from "./core/layoutModel.js";
import {
  clamp, pointInRect, pointInPolygon,
  getCenterRect, getEffectiveLayerCount,
  getDisplayDirectionalBandPolygon, getDisplayDirectionalEdgeRect, polygonToClipPath
} from "./core/geometry.js";

const OUTCOME_PALETTE = [
  "rgba(239, 68, 68, 0.30)", "rgba(249, 115, 22, 0.30)", "rgba(234, 179, 8, 0.30)",
  "rgba(132, 204, 22, 0.30)", "rgba(34, 197, 94, 0.30)", "rgba(20, 184, 166, 0.30)",
  "rgba(14, 165, 233, 0.30)", "rgba(59, 130, 246, 0.30)", "rgba(99, 102, 241, 0.30)",
  "rgba(139, 92, 246, 0.30)", "rgba(168, 85, 247, 0.30)", "rgba(217, 70, 239, 0.30)",
  "rgba(236, 72, 153, 0.30)", "rgba(244, 63, 94, 0.30)", "rgba(251, 146, 60, 0.30)",
  "rgba(163, 230, 53, 0.30)", "rgba(45, 212, 191, 0.30)", "rgba(6, 182, 212, 0.30)",
  "rgba(56, 189, 248, 0.30)", "rgba(96, 165, 250, 0.30)", "rgba(129, 140, 248, 0.30)",
  "rgba(167, 139, 250, 0.30)", "rgba(192, 132, 252, 0.30)", "rgba(244, 114, 182, 0.30)"
];

const ACTION_COLORS = {
  STACK: "rgba(110, 231, 255, 0.30)",
  SPLIT: "rgba(255, 217, 97, 0.22)",
  EQUALIZE: "rgba(123, 255, 155, 0.22)",
  WRAP: "rgba(255, 136, 222, 0.22)",
  INVALID: "rgba(255, 123, 123, 0.16)"
};

function zoneOutcomeKey(zone) {
  if (!zone || zone.type === "INVALID") return "INVALID";
  // Use outcome-based key so zones that produce the same layout share the same color
  // (e.g. left edge of right panel vs right edge of left panel → same EQUALIZE result)
  if (zone.type === "EQUALIZE") {
    return ["EQUALIZE", zone.targetId, Number.isFinite(zone.insertIndex) ? zone.insertIndex : ""].join("|");
  }
  return [zone.type, zone.direction, zone.panelId, zone.targetId, Number.isFinite(zone.insertIndex) ? zone.insertIndex : ""].join("|");
}

function zonesMatch(a, b) {
  if (!a || !b) return false;
  return a.direction === b.direction && a.type === b.type
    && a.panelId === b.panelId && a.targetId === b.targetId
    && a.insertIndex === b.insertIndex;
}

function chooseBetterZoneCandidate(current, next) {
  if (!next) return current;
  if (!current) return next;
  const [ci, ni] = [current.zone.type === "INVALID", next.zone.type === "INVALID"];
  if (ci !== ni) return ni ? current : next;
  return next.zone.layer < current.zone.layer ? next : current;
}

export function createDropZones(config, workspaceEl, { canAddSiblingToAxis, getRoot }) {
  const getWorkspaceBounds = () => workspaceEl.getBoundingClientRect();
  const getMinPanelWidthPx = () => Math.max(1, getWorkspaceBounds().width * config.minBoxWidthFraction);
  const getMinPanelHeightPx = () => Math.max(1, getWorkspaceBounds().height * config.minBoxHeightFraction);
  const getTabStripMinHeightPx = () => Math.max(1, getWorkspaceBounds().height * config.tabStripStackZoneMinHeightFraction);
  const canHostPanel = (bounds) => bounds.width >= getMinPanelWidthPx() && bounds.height >= getMinPanelHeightPx();

  function canSplitIntoSiblings(bounds, axis, count) {
    if (!bounds || count < 1 || !canHostPanel(bounds)) return false;
    return axis === "column"
      ? (bounds.width / count) >= getMinPanelWidthPx()
      : (bounds.height / count) >= getMinPanelHeightPx();
  }

  function getNodeElement(id) {
    return workspaceEl.querySelector(`[data-node-id="${id}"]`);
  }

  function isDirectionalLayerReachable(info, ancestorIndex, direction) {
    if (!info || !Array.isArray(info.ancestors) || ancestorIndex <= 0) return true;
    const insertBefore = isBeforeDirection(direction);
    for (let i = 1; i < ancestorIndex; i++) {
      const container = info.ancestors[i];
      const childSubtree = info.ancestors[i - 1];
      if (!container || container.type !== "container" || !childSubtree) return false;
      if (!isAlongAxis(container.axis, direction)) continue;
      const childIdx = container.children.findIndex((c) => c.id === childSubtree.id);
      if (childIdx === -1) return false;
      if (insertBefore ? childIdx !== 0 : childIdx !== container.children.length - 1) return false;
    }
    return true;
  }

  function getReachableLayerCount(info, totalLayers, direction) {
    let count = 0;
    for (let layer = 1; layer <= totalLayers; layer++) {
      if (!isDirectionalLayerReachable(info, layer - 1, direction)) break;
      count = layer;
    }
    return count;
  }

  function resolveDirectionalZone(info, panelBounds, layer, direction) {
    const invalid = (targetId, reason) => ({ layer, direction, type: "INVALID", targetId, reason });
    const stackMsg = (axis) => `Max ${axis === "column" ? "horizontal" : "vertical"} stack reached.`;

    if (layer === 1) {
      if (!canHostPanel(panelBounds)) return invalid(info.panel.id, "Panel is smaller than configured minimum size.");
      const splitAxis = axisForDirection(direction);
      if (!canAddSiblingToAxis(splitAxis, 2)) return invalid(info.panel.id, stackMsg(splitAxis));
      if (!canSplitIntoSiblings(panelBounds, splitAxis, 2)) return invalid(info.panel.id, "Split would create panels smaller than configured minimum size.");
      return { layer, direction, type: "SPLIT", panelId: info.panel.id, targetId: info.panel.id, reason: "Layer 1 directional split" };
    }

    const ancestorIndex = layer - 1;
    const ancestor = info.ancestors[ancestorIndex];
    const childSubtree = info.ancestors[ancestorIndex - 1];
    if (!ancestor || ancestor.type !== "container" || !childSubtree) {
      return invalid(info.panel.id, "No ancestor container available for this layer.");
    }

    const ancestorEl = getNodeElement(ancestor.id);
    if (!ancestorEl) return invalid(ancestor.id, "Ancestor element not found.");
    const ancestorBounds = ancestorEl.getBoundingClientRect();
    if (!canHostPanel(ancestorBounds)) return invalid(ancestor.id, "Ancestor area is smaller than configured minimum size.");

    if (isAlongAxis(ancestor.axis, direction)) {
      const nextCount = ancestor.children.length + 1;
      if (!canAddSiblingToAxis(ancestor.axis, nextCount)) return invalid(ancestor.id, stackMsg(ancestor.axis));
      if (!canSplitIntoSiblings(ancestorBounds, ancestor.axis, nextCount)) return invalid(ancestor.id, "Equalize would create panels smaller than configured minimum size.");
      const childIdx = ancestor.children.findIndex((c) => c.id === childSubtree.id);
      if (childIdx === -1) return invalid(ancestor.id, "Child subtree was not found in ancestor.");
      const insertIndex = isBeforeDirection(direction) ? childIdx : childIdx + 1;
      return { layer, direction, type: "EQUALIZE", targetId: ancestor.id, childSubtreeId: childSubtree.id, insertIndex, reason: `Layer ${layer} along ancestor axis (${ancestor.axis})` };
    }

    const wrapAxis = axisForDirection(direction);
    if (!canAddSiblingToAxis(wrapAxis, 2)) return invalid(ancestor.id, stackMsg(wrapAxis));
    if (!canSplitIntoSiblings(ancestorBounds, wrapAxis, 2)) return invalid(ancestor.id, "Wrap would create panels smaller than configured minimum size.");
    return { layer, direction, type: "WRAP", targetId: ancestor.id, reason: `Layer ${layer} perpendicular to ancestor axis (${ancestor.axis})` };
  }

  function buildDisplayZoneDescriptors(panelEl, info) {
    const panelBounds = panelEl.getBoundingClientRect();
    const descriptors = [];

    const tabsEl = panelEl.querySelector(".tabs");
    if (tabsEl && config.allowTabStripStackZone && panelBounds.height >= getTabStripMinHeightPx()) {
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
          const tabsBounds = { left, top, width: extendedRight - left, height: bottom - top };
          descriptors.push({
            key: "display-stack-tabs", layer: 0, direction: null,
            geometry: { kind: "rect", bounds: tabsBounds },
            zone: { layer: 0, direction: null, type: "STACK", panelId: info.panel.id, targetId: info.panel.id, reason: "Tab strip zone" },
            hit: (x, y) => pointInRect(x, y, tabsBounds)
          });
        }
      }
    }

    const bounds = panelBounds;
    const startRatio = clamp(config.centerFraction, 0, 0.95);
    const totalLayers = getEffectiveLayerCount(bounds, info.depth, config);

    // Check which layer-1 directions are invalid to expand center zone
    const invalidDirs = ["TOP", "BOTTOM", "LEFT", "RIGHT"].filter((dir) => {
      const reachable = getReachableLayerCount(info, totalLayers, dir);
      return reachable > 0 && resolveDirectionalZone(info, panelBounds, 1, dir).type === "INVALID";
    });

    // Expand center zone into invalid directions to eliminate dead zones
    let centerRect = getCenterRect(bounds, config);
    if (invalidDirs.length > 0) {
      let left = centerRect.left, top = centerRect.top;
      let right = centerRect.left + centerRect.width, bottom = centerRect.top + centerRect.height;
      if (invalidDirs.includes("LEFT")) left = bounds.left;
      if (invalidDirs.includes("RIGHT")) right = bounds.left + bounds.width;
      if (invalidDirs.includes("TOP")) top = bounds.top;
      if (invalidDirs.includes("BOTTOM")) bottom = bounds.top + bounds.height;
      centerRect = { left, top, width: right - left, height: bottom - top };
    }

    descriptors.push({
      key: "display-stack-center", layer: 0, direction: null,
      geometry: { kind: "rect", bounds: centerRect },
      zone: { layer: 0, direction: null, type: "STACK", panelId: info.panel.id, targetId: info.panel.id, reason: "Center zone" },
      hit: (x, y) => pointInRect(x, y, centerRect)
    });

    // Create directional zones, skipping invalid layer-1 directions
    for (const direction of ["TOP", "BOTTOM", "LEFT", "RIGHT"]) {
      const reachable = getReachableLayerCount(info, totalLayers, direction);
      for (let layer = 1; layer <= reachable; layer++) {
        const zone = resolveDirectionalZone(info, panelBounds, layer, direction);
        if (zone.type === "INVALID") continue;

        const isOuterEdge = layer === reachable;
        if (isOuterEdge) {
          const edgeRect = getDisplayDirectionalEdgeRect(bounds, reachable, direction, startRatio);
          if (!edgeRect || edgeRect.width <= 0 || edgeRect.height <= 0) continue;
          descriptors.push({
            key: `display-layer-${layer}-${direction}`, layer, direction,
            geometry: { kind: "rect", bounds: edgeRect },
            zone,
            hit: (x, y) => pointInRect(x, y, edgeRect)
          });
        } else {
          const poly = getDisplayDirectionalBandPolygon(bounds, layer, reachable, direction, startRatio);
          if (!poly || poly.length < 3) continue;
          descriptors.push({
            key: `display-layer-${layer}-${direction}`, layer, direction,
            geometry: { kind: "polygon", bounds, points: poly, clipPath: polygonToClipPath(bounds, poly) },
            zone,
            hit: (x, y) => pointInPolygon(x, y, poly)
          });
        }
      }
    }

    return descriptors;
  }

  function findZoneAtPoint(descriptors, x, y) {
    if (!descriptors || descriptors.length === 0) return null;
    const matches = descriptors.filter((d) => d.hit(x, y)).sort((a, b) => a.layer - b.layer);
    return matches[0] || null;
  }

  function hitTestZone(panelEl, panelInfo, x, y) {
    const hit = findZoneAtPoint(buildDisplayZoneDescriptors(panelEl, panelInfo), x, y);
    return hit ? hit.zone : null;
  }

  function buildBetweenSiblingsDescriptors() {
    const root = getRoot();
    const descriptors = [];
    for (const containerEl of workspaceEl.querySelectorAll(".container[data-node-id]")) {
      const found = findNodeById(root, containerEl.dataset.nodeId);
      if (!found || found.node.type !== "container") continue;
      const containerNode = found.node;
      if (containerNode.children.length < 2) continue;
      const nextCount = containerNode.children.length + 1;
      if (!canAddSiblingToAxis(containerNode.axis, nextCount)) continue;
      const containerBounds = containerEl.getBoundingClientRect();
      if (!canSplitIntoSiblings(containerBounds, containerNode.axis, nextCount)) continue;

      const childEls = Array.from(containerEl.children).filter((el) => el.classList.contains("child"));
      if (childEls.length < 2) continue;
      const isHoriz = containerNode.axis === "column";
      const direction = isHoriz ? "RIGHT" : "BOTTOM";

      for (let i = 0; i < childEls.length - 1; i++) {
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
          layer: 2, direction, panelId: childPanelId,
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

  function resolveHoverAtPoint(panelInfoMap, x, y) {
    const hovered = document.elementFromPoint(x, y);
    const hoveredPanelEl = hovered ? hovered.closest(".panel[data-panel-id]") : null;
    if (hoveredPanelEl && workspaceEl.contains(hoveredPanelEl)) {
      const panelId = hoveredPanelEl.dataset.panelId;
      const info = panelInfoMap.get(panelId);
      if (info) {
        const zone = hitTestZone(hoveredPanelEl, info, x, y);
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
      best = chooseBetterZoneCandidate(best, { panelEl, panelId: betweenSibling.panelId, info: null, zone: betweenSibling.zone });
    }

    return best;
  }

  function findBetweenSiblingsZoneAtPoint(x, y) {
    let best = null;
    for (const d of buildBetweenSiblingsDescriptors()) {
      if (!d.hit(x, y)) continue;
      const candidate = { panelId: d.panelId, info: null, zone: d.zone, metric: d.distance(x, y) };
      if (!best || candidate.metric < best.metric) best = candidate;
    }
    return best;
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
    let nextColorIdx = 0;

    function resolveColor(zone) {
      if (!zone || zone.type === "INVALID") return ACTION_COLORS.INVALID;
      const key = zoneOutcomeKey(zone);
      if (!outcomeColorMap.has(key)) {
        outcomeColorMap.set(key, OUTCOME_PALETTE[nextColorIdx++ % OUTCOME_PALETTE.length]);
      }
      return outcomeColorMap.get(key);
    }

    for (const [panelId, info] of panelInfoMap.entries()) {
      const panelEl = workspaceEl.querySelector(`.panel[data-panel-id="${panelId}"]`);
      if (!panelEl) continue;
      for (const descriptor of buildDisplayZoneDescriptors(panelEl, info)) {
        const { geometry, zone } = descriptor;
        const zoneEl = document.createElement("div");
        zoneEl.className = "zone";
        zoneEl.style.left = `${geometry.bounds.left - overlayRect.left}px`;
        zoneEl.style.top = `${geometry.bounds.top - overlayRect.top}px`;
        zoneEl.style.width = `${geometry.bounds.width}px`;
        zoneEl.style.height = `${geometry.bounds.height}px`;
        zoneEl.style.opacity = geometry.kind === "polygon" ? "0.62" : "0.68";
        if (geometry.kind === "polygon") zoneEl.style.clipPath = geometry.clipPath;
        zoneEl.style.background = resolveColor(zone);
        const isSelected = selectedZone && zonesMatch(zone, selectedZone);
        if (isSelected) zoneEl.classList.add("selected");
        else if (hasSelection) zoneEl.classList.add("dimmed");
        overlay.appendChild(zoneEl);
      }
    }
  }

  return { hitTestZone, resolveHoverAtPoint, drawZonesForWorkspace };
}
