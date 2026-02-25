(function attachLayoutModel(global) {
  "use strict";

  function cloneNode(node) {
    if (node.type === "panel") {
      return {
        ...node,
        tabs: node.tabs.map((t) => ({ ...t }))
      };
    }
    return {
      ...node,
      sizes: [...node.sizes],
      children: node.children.map(cloneNode)
    };
  }

  function axisForDirection(dir) {
    return (dir === "LEFT" || dir === "RIGHT") ? "column" : "row";
  }

  function isAlongAxis(axis, dir) {
    if (axis === "column") {
      return dir === "LEFT" || dir === "RIGHT";
    }
    return dir === "TOP" || dir === "BOTTOM";
  }

  function isBeforeDirection(dir) {
    return dir === "LEFT" || dir === "TOP";
  }

  function buildPanelInfoMap(node) {
    const map = new Map();

    function walk(curr, ancestors, parent, indexInParent, depth) {
      if (curr.type === "panel") {
        map.set(curr.id, {
          panel: curr,
          ancestors: [curr, ...ancestors],
          parent,
          indexInParent,
          depth
        });
        return;
      }

      curr.children.forEach((child, idx) => {
        walk(child, [curr, ...ancestors], curr, idx, depth + 1);
      });
    }

    walk(node, [], null, -1, 0);
    return map;
  }

  function findNodeById(node, id, parent = null, indexInParent = -1) {
    if (node.id === id) {
      return { node, parent, indexInParent };
    }
    if (node.type === "container") {
      for (let i = 0; i < node.children.length; i += 1) {
        const found = findNodeById(node.children[i], id, node, i);
        if (found) return found;
      }
    }
    return null;
  }

  function removePanelAndCollapse(node, panelIdToRemove, createFallbackRoot) {
    function inner(curr) {
      if (curr.type === "panel") {
        if (curr.id === panelIdToRemove) return null;
        return curr;
      }

      const nextChildren = [];
      const nextSizes = [];
      for (let i = 0; i < curr.children.length; i += 1) {
        const child = curr.children[i];
        const next = inner(child);
        if (next) nextChildren.push(next);
        if (next) nextSizes.push(curr.sizes[i] ?? 1);
      }

      if (nextChildren.length === 0) return null;
      if (nextChildren.length === 1) return nextChildren[0];

      const totalSize = nextSizes.reduce((sum, size) => sum + size, 0);
      const normalizedSizes = totalSize > 0
        ? nextSizes.map((size) => size / totalSize)
        : nextChildren.map(() => 1 / nextChildren.length);

      return {
        ...curr,
        children: nextChildren,
        sizes: normalizedSizes
      };
    }

    const out = inner(node);
    if (out) return out;

    if (typeof createFallbackRoot === "function") {
      return createFallbackRoot();
    }

    throw new Error("removePanelAndCollapse requires createFallbackRoot when tree becomes empty.");
  }

  function panelTreeString(node) {
    if (node.type === "panel") {
      const active = node.tabs.find((t) => t.id === node.activeTabId) || node.tabs[0];
      return `P${active ? active.num : "?"}`;
    }
    const label = node.axis === "column" ? "column" : "row";
    return `${label}[${node.children.map(panelTreeString).join(", ")}]`;
  }

  function getPanelCount(node) {
    if (node.type === "panel") return 1;
    return node.children.reduce((sum, child) => sum + getPanelCount(child), 0);
  }

  function getTotalBoxCount(node) {
    if (node.type === "panel") return node.tabs.length;
    return node.children.reduce((sum, child) => sum + getTotalBoxCount(child), 0);
  }

  function getFirstPanel(node) {
    if (node.type === "panel") return node;
    for (const c of node.children) {
      const p = getFirstPanel(c);
      if (p) return p;
    }
    return null;
  }

  global.LayoutModel = {
    cloneNode,
    axisForDirection,
    isAlongAxis,
    isBeforeDirection,
    buildPanelInfoMap,
    findNodeById,
    removePanelAndCollapse,
    panelTreeString,
    getPanelCount,
    getTotalBoxCount,
    getFirstPanel
  };
})(window);
