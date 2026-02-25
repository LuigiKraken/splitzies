(function attachZoneGeometry(global) {
  "use strict";

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const pointInRect = (x, y, r) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;

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
    return { left: bounds.left + (bounds.width - w) / 2, top: bounds.top + (bounds.height - h) / 2, width: w, height: h };
  }

  const getEffectiveLayerCount = (bounds, depth, config) => {
    const directionalLayerCount = Math.min(depth, config.maxDepth) + 1;
    const maxByPx = Math.floor(Math.min(bounds.width, bounds.height) / (2 * config.minBandPx));
    return Math.max(1, Math.min(directionalLayerCount, maxByPx || 1));
  };

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

  function clipAlongAxis(poly, min, max, isHorizontal) {
    const intersect = isHorizontal ? intersectSegmentWithHorizontal : intersectSegmentWithVertical;
    const coord = isHorizontal ? (p) => p.y : (p) => p.x;
    poly = clipPolygon(poly, (p) => coord(p) >= min, (a, b) => intersect(a, b, min));
    poly = clipPolygon(poly, (p) => coord(p) <= max, (a, b) => intersect(a, b, max));
    return poly;
  }

  function getDirectionalBandPolygonByRatio(bounds, direction, innerRatio, outerRatio) {
    const inner = clamp(innerRatio, 0, 1);
    const outer = clamp(outerRatio, 0, 1);
    if (outer <= inner) return [];
    const cx = bounds.left + bounds.width / 2;
    const cy = bounds.top + bounds.height / 2;
    const halfW = bounds.width / 2;
    const halfH = bounds.height / 2;

    const poly = getDirectionalBasePolygon(bounds, direction);
    if (!poly.length) return poly;

    if (direction === "LEFT" || direction === "RIGHT") {
      const xMin = direction === "LEFT" ? cx - outer * halfW : cx + inner * halfW;
      const xMax = direction === "LEFT" ? cx - inner * halfW : cx + outer * halfW;
      return clipAlongAxis(poly, xMin, xMax, false);
    }
    const yMin = direction === "TOP" ? cy - outer * halfH : cy + inner * halfH;
    const yMax = direction === "TOP" ? cy - inner * halfH : cy + outer * halfH;
    return clipAlongAxis(poly, yMin, yMax, true);
  }

  const getDisplayDirectionalBandPolygon = (bounds, layer, totalLayers, direction, startRatio) => {
    if (layer < 1 || totalLayers < 1) return [];
    const safeStart = clamp(startRatio, 0, 0.95);
    const ring = (1 - safeStart) / totalLayers;
    return getDirectionalBandPolygonByRatio(bounds, direction, safeStart + (layer - 1) * ring, safeStart + layer * ring);
  };

  const polygonToClipPath = (bounds, poly) => {
    if (!poly || poly.length < 3 || bounds.width <= 0 || bounds.height <= 0) return "";
    return `polygon(${poly.map((p) => `${clamp(((p.x - bounds.left) / bounds.width) * 100, 0, 100)}% ${clamp(((p.y - bounds.top) / bounds.height) * 100, 0, 100)}%`).join(", ")})`;
  };

  global.ZoneGeometry = {
    clamp,
    pointInRect,
    pointInPolygon,
    getCenterRect,
    getEffectiveLayerCount,
    getDisplayDirectionalBandPolygon,
    polygonToClipPath
  };
})(window);
