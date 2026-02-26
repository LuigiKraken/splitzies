import { findNodeById, getFirstPanel } from "./core/layoutModel.js";
import { VIEW_MODES } from "./config.js";

const SCHEMA_VERSION = 1;
const STORAGE_KEY = `splitsy-layout-v${SCHEMA_VERSION}`;

function isValidTab(tab) {
  return !!tab && typeof tab === "object" && typeof tab.id === "string" && Number.isFinite(tab.num) && tab.num > 0;
}

function isValidNode(node) {
  if (!node || typeof node !== "object" || typeof node.id !== "string") return false;
  if (node.type === "panel") {
    return Array.isArray(node.tabs) && node.tabs.length > 0 && node.tabs.every(isValidTab)
      && (node.activeTabId === null || (typeof node.activeTabId === "string" && node.tabs.some((t) => t.id === node.activeTabId)));
  }
  if (node.type === "container") {
    return (node.axis === "row" || node.axis === "column")
      && Array.isArray(node.children) && node.children.length > 0
      && Array.isArray(node.sizes) && node.sizes.length === node.children.length
      && node.sizes.every((s) => Number.isFinite(s) && s > 0)
      && node.children.every(isValidNode);
  }
  return false;
}

function extractTrailingNumber(id) {
  const match = typeof id === "string" && /-(\d+)$/.exec(id);
  return match ? Math.max(0, parseInt(match[1], 10)) : 0;
}

function collectTreeStats(node, stats = { maxIdNumber: 0, maxBoxNumber: 0 }) {
  stats.maxIdNumber = Math.max(stats.maxIdNumber, extractTrailingNumber(node.id));
  if (node.type === "panel") {
    for (const tab of node.tabs) {
      stats.maxIdNumber = Math.max(stats.maxIdNumber, extractTrailingNumber(tab.id));
      stats.maxBoxNumber = Math.max(stats.maxBoxNumber, tab.num);
    }
  } else {
    for (const child of node.children) collectTreeStats(child, stats);
  }
  return stats;
}

export function createPersistence(persistLayout, defaultPreviewMode) {
  return {
    save({ root, activePanelId, previewMode, idCounter, panelCounter }) {
      if (!persistLayout) return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, root, activePanelId, previewMode, idCounter, panelCounter }));
      } catch (_) {}
    },

    clear() {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    },

    restore() {
      if (!persistLayout) return null;
      let parsed;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        parsed = JSON.parse(raw);
      } catch (_) { return null; }

      if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !isValidNode(parsed.root) || !getFirstPanel(parsed.root)) return null;

      const root = parsed.root;
      const previewMode = VIEW_MODES.includes(parsed.previewMode) ? parsed.previewMode : defaultPreviewMode;
      let activePanelId = typeof parsed.activePanelId === "string" ? parsed.activePanelId : null;

      const stats = collectTreeStats(root);
      const safeInt = (v, fb) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : fb; };
      const idCounter = Math.max(safeInt(parsed.idCounter, 1), stats.maxIdNumber + 1);
      const panelCounter = Math.max(safeInt(parsed.panelCounter, 1), stats.maxBoxNumber + 1);

      const found = activePanelId ? findNodeById(root, activePanelId) : null;
      if (!found || found.node.type !== "panel") {
        const first = getFirstPanel(root);
        activePanelId = first ? first.id : null;
      }

      return { root, activePanelId, previewMode, idCounter, panelCounter };
    }
  };
}
