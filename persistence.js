(function attachPersistence(global) {
  "use strict";

  function create({ persistLayout, defaultPreviewMode, findNodeById, getFirstPanel }) {
    const SCHEMA_VERSION = 1;
    const STORAGE_KEY = `dock-layout-state-v${SCHEMA_VERSION}`;
    const VIEW_MODES = ["hitbox", "preview", "combined"];

    function isValidTab(tab) {
      return !!tab
        && typeof tab === "object"
        && typeof tab.id === "string"
        && Number.isFinite(tab.num)
        && tab.num > 0;
    }

    function isValidNode(node) {
      if (!node || typeof node !== "object" || typeof node.id !== "string") return false;
      if (node.type === "panel") {
        if (!Array.isArray(node.tabs) || node.tabs.length === 0) return false;
        if (!node.tabs.every(isValidTab)) return false;
        if (node.activeTabId !== null && typeof node.activeTabId !== "string") return false;
        if (node.activeTabId && !node.tabs.some((tab) => tab.id === node.activeTabId)) return false;
        return true;
      }
      if (node.type === "container") {
        if (node.axis !== "row" && node.axis !== "column") return false;
        if (!Array.isArray(node.children) || node.children.length === 0) return false;
        if (!Array.isArray(node.sizes) || node.sizes.length !== node.children.length) return false;
        if (!node.sizes.every((size) => Number.isFinite(size) && size > 0)) return false;
        return node.children.every(isValidNode);
      }
      return false;
    }

    function extractTrailingIdNumber(id) {
      if (typeof id !== "string") return 0;
      const match = /-(\d+)$/.exec(id);
      if (!match) return 0;
      const value = Number.parseInt(match[1], 10);
      return Number.isFinite(value) && value > 0 ? value : 0;
    }

    function collectTreeStats(node, stats = { maxIdNumber: 0, maxBoxNumber: 0 }) {
      stats.maxIdNumber = Math.max(stats.maxIdNumber, extractTrailingIdNumber(node.id));
      if (node.type === "panel") {
        for (const tab of node.tabs) {
          stats.maxIdNumber = Math.max(stats.maxIdNumber, extractTrailingIdNumber(tab.id));
          stats.maxBoxNumber = Math.max(stats.maxBoxNumber, tab.num);
        }
        return stats;
      }
      for (const child of node.children) {
        collectTreeStats(child, stats);
      }
      return stats;
    }

    function safePositiveInt(value, fallback) {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    function persistLayoutState({ root, activePanelId, previewMode, idCounter, panelCounter }) {
      if (!persistLayout) return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          schemaVersion: SCHEMA_VERSION, root, activePanelId, previewMode, idCounter, panelCounter
        }));
      } catch (err) {}
    }

    function clearPersistedLayoutState() {
      try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
    }

    // Returns the restored state object on success, or null if nothing to restore.
    function restorePersistedLayoutState() {
      if (!persistLayout) return null;
      let parsed = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        parsed = JSON.parse(raw);
      } catch (err) {
        return null;
      }

      if (!parsed || typeof parsed !== "object") return null;
      if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
      if (!isValidNode(parsed.root)) return null;
      if (!getFirstPanel(parsed.root)) return null;

      const root = parsed.root;
      const previewMode = VIEW_MODES.includes(parsed.previewMode) ? parsed.previewMode : defaultPreviewMode;
      let activePanelId = typeof parsed.activePanelId === "string" ? parsed.activePanelId : null;

      const stats = collectTreeStats(root);
      const idCounter = Math.max(safePositiveInt(parsed.idCounter, 1), stats.maxIdNumber + 1);
      const panelCounter = Math.max(safePositiveInt(parsed.panelCounter, 1), stats.maxBoxNumber + 1);

      const activeFound = activePanelId ? findNodeById(root, activePanelId) : null;
      if (!activeFound || activeFound.node.type !== "panel") {
        const firstPanel = getFirstPanel(root);
        activePanelId = firstPanel ? firstPanel.id : null;
      }

      return { root, activePanelId, previewMode, idCounter, panelCounter };
    }

    return { persistLayoutState, clearPersistedLayoutState, restorePersistedLayoutState };
  }

  global.Persistence = { create };
})(window);
