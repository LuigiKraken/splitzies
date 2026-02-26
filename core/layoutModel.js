export function cloneNode(node) {
  if (node.type === "panel") {
    return { ...node, tabs: node.tabs.map((t) => ({ ...t })) };
  }
  return { ...node, sizes: [...node.sizes], children: node.children.map(cloneNode) };
}

export function axisForDirection(dir) {
  return (dir === "LEFT" || dir === "RIGHT") ? "column" : "row";
}

export function isAlongAxis(axis, dir) {
  return axis === "column"
    ? (dir === "LEFT" || dir === "RIGHT")
    : (dir === "TOP" || dir === "BOTTOM");
}

export function isBeforeDirection(dir) {
  return dir === "LEFT" || dir === "TOP";
}

export function buildPanelInfoMap(node) {
  const map = new Map();

  function walk(curr, ancestors, parent, indexInParent, depth) {
    if (curr.type === "panel") {
      map.set(curr.id, { panel: curr, ancestors: [curr, ...ancestors], parent, indexInParent, depth });
      return;
    }
    curr.children.forEach((child, idx) => {
      walk(child, [curr, ...ancestors], curr, idx, depth + 1);
    });
  }

  walk(node, [], null, -1, 0);
  return map;
}

export function findNodeById(node, id, parent = null, indexInParent = -1) {
  if (node.id === id) return { node, parent, indexInParent };
  if (node.type === "container") {
    for (let i = 0; i < node.children.length; i++) {
      const found = findNodeById(node.children[i], id, node, i);
      if (found) return found;
    }
  }
  return null;
}

export function removePanelAndCollapse(node, panelIdToRemove, createFallbackRoot) {
  function inner(curr) {
    if (curr.type === "panel") return curr.id === panelIdToRemove ? null : curr;

    const nextChildren = [];
    const nextSizes = [];
    for (let i = 0; i < curr.children.length; i++) {
      const next = inner(curr.children[i]);
      if (next) {
        nextChildren.push(next);
        nextSizes.push(curr.sizes[i] ?? 1);
      }
    }

    if (nextChildren.length === 0) return null;
    if (nextChildren.length === 1) return nextChildren[0];

    const totalSize = nextSizes.reduce((sum, s) => sum + s, 0);
    return {
      ...curr,
      children: nextChildren,
      sizes: totalSize > 0 ? nextSizes.map((s) => s / totalSize) : nextChildren.map(() => 1 / nextChildren.length)
    };
  }

  const out = inner(node);
  if (out) return out;
  if (typeof createFallbackRoot === "function") return createFallbackRoot();
  throw new Error("removePanelAndCollapse: tree became empty and no fallback provided.");
}

export function panelTreeString(node) {
  if (node.type === "panel") {
    const active = node.tabs.find((t) => t.id === node.activeTabId) || node.tabs[0];
    return `P${active ? active.num : "?"}`;
  }
  return `${node.axis}[${node.children.map(panelTreeString).join(", ")}]`;
}

export function getPanelCount(node) {
  if (node.type === "panel") return 1;
  return node.children.reduce((sum, child) => sum + getPanelCount(child), 0);
}

export function getTotalBoxCount(node) {
  if (node.type === "panel") return node.tabs.length;
  return node.children.reduce((sum, child) => sum + getTotalBoxCount(child), 0);
}

export function getFirstPanel(node) {
  if (node.type === "panel") return node;
  for (const c of node.children) {
    const p = getFirstPanel(c);
    if (p) return p;
  }
  return null;
}
