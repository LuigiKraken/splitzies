import { CONFIG, VIEW_MODES } from "./config.js";
import {
  cloneNode, axisForDirection, isBeforeDirection, buildPanelInfoMap,
  findNodeById, removePanelAndCollapse, getPanelCount, getTotalBoxCount, getFirstPanel
} from "./core/layoutModel.js";
import { executeDrop } from "./core/dropActions.js";
import { createDropZones } from "./dropZones.js";
import { createDragController } from "./dragController.js";
import { createResizeController } from "./resizeController.js";
import { createRenderer } from "./render.js";
import { createAnimations } from "./animations.js";
import { createPersistence } from "./persistence.js";

// ── State ────────────────────────────────────────────────────────────────────

let idCounter = 1;
let panelCounter = 1;
let root = createPanelNode(createBoxTab());
let activePanelId = root.id;
let previewMode = CONFIG.defaultPreviewMode;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const workspaceEl = document.getElementById("workspace");
const statusEl = document.getElementById("status");
const treeViewEl = document.getElementById("treeView");
const createBtn = document.getElementById("createBtn");
const resetBtn = document.getElementById("resetBtn");
const viewModeBtn = document.getElementById("viewModeBtn");
const darkModeBtn = document.getElementById("darkModeBtn");

// ── Node factories ───────────────────────────────────────────────────────────

function nextId(prefix) { return `${prefix}-${idCounter++}`; }

function createBoxTab() {
  return { id: nextId("tab"), num: panelCounter++ };
}

function createPanelNode(tab) {
  return { type: "panel", id: nextId("panel"), tabs: [tab], activeTabId: tab.id };
}

function createContainer(axis, children) {
  const size = 1 / children.length;
  return { type: "container", id: nextId("container"), axis, sizes: children.map(() => size), children };
}

function createFallbackRoot() { return createPanelNode(createBoxTab()); }

function makeNodeFactories(idSeed, panelSeed) {
  let lid = idSeed, lpn = panelSeed;
  const nid = (prefix) => `${prefix}-${lid++}`;
  return {
    createPanelNode: (tab) => ({ type: "panel", id: nid("panel"), tabs: [tab], activeTabId: tab.id }),
    createContainer: (axis, ch) => ({ type: "container", id: nid("container"), axis, sizes: ch.map(() => 1 / ch.length), children: ch }),
    createFallbackRoot() { const t = { id: nid("tab"), num: lpn++ }; return this.createPanelNode(t); },
    axisForDirection,
    isBeforeDirection
  };
}

const nodeFactories = { createPanelNode, createContainer, createFallbackRoot, axisForDirection, isBeforeDirection };

// ── Derived helpers ──────────────────────────────────────────────────────────

const axisStackLimit = (axis) => axis === "column" ? CONFIG.maxHorizontalStack : CONFIG.maxVerticalStack;
const canAddSiblingToAxis = (axis, count) => count <= axisStackLimit(axis);
const canCreateAnotherBox = () => getTotalBoxCount(root) < CONFIG.maxTotalBoxCount;

function applyDrop(zone, tab, sourcePanelId) {
  const result = executeDrop(root, zone, tab, sourcePanelId, nodeFactories);
  if (!result) return;
  root = result.root;
  activePanelId = result.activePanelId;
}

// ── Sub-systems ──────────────────────────────────────────────────────────────

const drag = createDragController(CONFIG.previewMoveThresholdPx);

const persistence = createPersistence(CONFIG.persistLayout, CONFIG.defaultPreviewMode);

const { resolveHoverAtPoint, drawZonesForWorkspace } = createDropZones(CONFIG, workspaceEl, {
  canAddSiblingToAxis,
  getRoot: () => root
});

const { render, renderPreviewTree, clearDropPreviewLayer, clearDragOverlay } = createRenderer(
  workspaceEl, treeViewEl, {
    getRoot: () => root,
    getActivePanelId: () => activePanelId,
    setActivePanelId: (id) => { activePanelId = id; },
    handlers: {
      onCloseTabClick, onTabClick, onTabDragStart, onTabDragEnd,
      onPanelClick, onPanelDragOver, onPanelDrop,
      onResizeHandlePointerDown: (e, panelId, handle) => resize.onResizeHandlePointerDown(e, panelId, handle)
    }
  }
);

const { animateDropTransition, animatePreviewTransition } = createAnimations(workspaceEl, CONFIG);

const resize = createResizeController(CONFIG, workspaceEl, statusEl, {
  getRoot: () => root,
  setRoot: (r) => { root = r; },
  setActivePanelId: (id) => { activePanelId = id; },
  getDragCtx: () => drag.dragCtx,
  renderWithoutPersist() { render(); syncOverlayForCurrentMode(); },
  renderAndPersist: renderAndPersist
});

// ── Restore persisted state ──────────────────────────────────────────────────

(function restoreIfAvailable() {
  const restored = persistence.restore();
  if (!restored) return;
  root = restored.root;
  activePanelId = restored.activePanelId;
  previewMode = restored.previewMode;
  idCounter = restored.idCounter;
  panelCounter = restored.panelCounter;
})();

// ── Render / persist ─────────────────────────────────────────────────────────

function renderAndPersist() {
  render();
  syncOverlayForCurrentMode();
  persistence.save({ root, activePanelId, previewMode, idCounter, panelCounter });
}

function renderAndPersistWithDropTransition(previousRects, enteredPanelId = null) {
  renderAndPersist();
  animateDropTransition(previousRects, enteredPanelId);
}

function capturePanelRects() {
  const map = new Map();
  for (const el of workspaceEl.querySelectorAll(".panel[data-panel-id]")) {
    const r = el.getBoundingClientRect();
    map.set(el.dataset.panelId, { left: r.left, top: r.top, width: r.width, height: r.height });
  }
  return map;
}

// ── Runtime CSS vars ─────────────────────────────────────────────────────────

function applyRuntimeStyleConfig() {
  const wb = workspaceEl.getBoundingClientRect();
  const w = wb.width || window.innerWidth || 1;
  const h = wb.height || window.innerHeight || 1;
  document.documentElement.style.setProperty("--min-box-width-px", `${Math.max(1, Math.round(w * CONFIG.minBoxWidthFraction))}px`);
  document.documentElement.style.setProperty("--min-box-height-px", `${Math.max(1, Math.round(h * CONFIG.minBoxHeightFraction))}px`);
}
applyRuntimeStyleConfig();

// ── Dark mode ────────────────────────────────────────────────────────────────

let isDarkMode = true;
function applyDarkMode(dark) {
  isDarkMode = dark;
  document.documentElement.dataset.theme = dark ? "dark" : "";
  darkModeBtn.textContent = dark ? "Light Mode" : "Dark Mode";
  try { localStorage.setItem("splitzies-dark-mode", dark ? "1" : "0"); } catch (_) {}
}
try { applyDarkMode(localStorage.getItem("splitzies-dark-mode") !== "0"); } catch (_) { applyDarkMode(true); }
darkModeBtn.addEventListener("click", () => applyDarkMode(!isDarkMode));

// ── Drag ghost ───────────────────────────────────────────────────────────────

let dragGhostEl = null;
let transparentDragImage = null;

function removeDragGhost() { if (dragGhostEl) { dragGhostEl.remove(); dragGhostEl = null; } }
function ensureDragGhost(label) {
  removeDragGhost();
  const ghost = document.createElement("div");
  ghost.className = "create-drag-ghost";
  ghost.textContent = label;
  document.body.appendChild(ghost);
  dragGhostEl = ghost;
}
function moveDragGhost(pt) {
  if (dragGhostEl) dragGhostEl.style.transform = `translate(${pt.x + 14}px, ${pt.y + 14}px)`;
}
function getTransparentDragImage() {
  if (!transparentDragImage) { transparentDragImage = document.createElement("canvas"); transparentDragImage.width = 1; transparentDragImage.height = 1; }
  return transparentDragImage;
}

// ── Zone summary formatting ──────────────────────────────────────────────────

function formatZoneSummary(zone) {
  if (!zone) return "";
  const dir = zone.direction ? ` dir=${zone.direction}` : "";
  const tgt = zone.targetId ? ` target=${zone.targetId}` : "";
  return `${zone.type} | layer=${zone.layer}${dir}${tgt}`;
}

// ── Overlay sync ─────────────────────────────────────────────────────────────

function syncOverlayForCurrentMode() {
  if (drag.dragCtx) return;
  if (previewMode === "hitbox" || previewMode === "combined") drawZonesForWorkspace(buildPanelInfoMap(root), null, null, { dimUnselected: false });
  else clearDragOverlay();
}

// ── Drag session ─────────────────────────────────────────────────────────────

function cleanupDragUI(message = null, shouldRender = false) {
  drag.resetDragSession();
  removeDragGhost();
  clearDragOverlay();
  if (message) statusEl.textContent = message;
  if (shouldRender) renderAndPersist();
}

function updateHoverFromPoint(x, y) {
  if (!drag.dragCtx) return;
  const panelInfoMap = buildPanelInfoMap(root);
  const hover = resolveHoverAtPoint(panelInfoMap, x, y);
  if (!hover) {
    drag.hoverPreview = null;
    if (previewMode === "hitbox" || previewMode === "combined") {
      drawZonesForWorkspace(panelInfoMap, null, null, { dimUnselected: false });
      statusEl.textContent = previewMode === "hitbox"
        ? "Hitbox mode: all drop zones remain visible while dragging."
        : "Combined mode: all drop zones remain visible while dragging.";
    } else {
      clearDragOverlay();
      statusEl.textContent = "Move over a panel to preview drop zones.";
    }
    return;
  }
  drag.hoverPreview = { panelId: hover.panelId || null, depth: hover.info ? hover.info.depth : null, zone: hover.zone };
  drawZonesForWorkspace(panelInfoMap, hover.zone, hover.panelId, { dimUnselected: previewMode !== "hitbox" });
  if (hover.zone) {
    statusEl.textContent = hover.zone.type === "INVALID"
      ? `Preview blocked: ${hover.zone.reason}`
      : `Preview: ${formatZoneSummary(hover.zone)}. ${hover.zone.reason}`;
  } else {
    statusEl.textContent = "Preview: no-op (panel too small or invalid layer).";
  }
}

// ── Drop preview (preview / combined modes) ──────────────────────────────────

function buildDropPreviewTree(zone) {
  if (!drag.dragCtx || !zone) return null;
  const factories = makeNodeFactories(idCounter, panelCounter);
  const result = executeDrop(root, zone, drag.dragCtx.tab, drag.dragCtx.sourcePanelId, factories);
  return result ? result.root : null;
}

function showDropPreview(zone) {
  const previewLayer = document.getElementById("workspacePreview");
  if (!previewLayer) return;
  const sourceRects = capturePanelRects();
  const previewTree = buildDropPreviewTree(zone);
  if (!previewTree) return;
  const treeDom = renderPreviewTree(previewTree);
  treeDom.style.width = "100%";
  treeDom.style.height = "100%";
  previewLayer.replaceChildren(treeDom);
  previewLayer.classList.toggle("combined-tone", previewMode === "combined");
  previewLayer.classList.add("active");
  workspaceEl.classList.add("previewing");
  animatePreviewTransition(previewLayer, sourceRects);
}

function scheduleIdlePreview() {
  drag.schedulePreviewIdle(() => {
    if (!drag.dragCtx || (previewMode !== "preview" && previewMode !== "combined") || !drag.lastDragPoint) return;
    const hover = resolveHoverAtPoint(buildPanelInfoMap(root), drag.lastDragPoint.x, drag.lastDragPoint.y);
    if (!hover || !hover.zone) return;
    if (hover.zone.type === "INVALID") { statusEl.textContent = `Preview blocked: ${hover.zone.reason}`; return; }
    drag.hoverPreview = { panelId: hover.panelId || null, depth: hover.info ? hover.info.depth : null, zone: hover.zone };
    if (previewMode === "combined") {
      const overlay = document.getElementById("workspaceOverlay");
      if (overlay) overlay.classList.add("faded");
    } else {
      clearDragOverlay();
    }
    showDropPreview(hover.zone);
    statusEl.textContent = `Preview: ${formatZoneSummary(hover.zone)}. Hold still to inspect, move to continue searching.`;
  }, CONFIG.previewIdleMs);
}

function showPreviewSearchState(x, y) {
  clearDropPreviewLayer();
  drag.hoverPreview = null;
  clearDragOverlay();
  const hover = resolveHoverAtPoint(buildPanelInfoMap(root), x, y);
  if (!hover) statusEl.textContent = "Move over a panel and pause briefly to see the drop preview.";
  else if (!hover.zone) statusEl.textContent = "No valid drop zone here. Move and pause in another spot.";
  else if (hover.zone.type === "INVALID") statusEl.textContent = `Preview blocked: ${hover.zone.reason}`;
  else statusEl.textContent = "Pause briefly to show drop preview.";
}

// ── Drag-over dispatch (unified for all three modes) ─────────────────────────

function dispatchDragOver(x, y) {
  if (previewMode === "hitbox") {
    updateHoverFromPoint(x, y);
  } else if (previewMode === "combined") {
    drag.handlePreviewModeDragOver(x, y, () => {
      clearDropPreviewLayer();
      const overlay = document.getElementById("workspaceOverlay");
      if (overlay) overlay.classList.remove("faded");
      drag.hoverPreview = null;
      updateHoverFromPoint(x, y);
      statusEl.textContent = "Combined mode: hitboxes visible while moving. Pause briefly for a softer preview overlay.";
      scheduleIdlePreview();
    });
  } else {
    drag.handlePreviewModeDragOver(x, y, () => {
      showPreviewSearchState(x, y);
      scheduleIdlePreview();
    });
  }
}

// ── Drop commit ──────────────────────────────────────────────────────────────

function commitDrop(zone, dragCtx) {
  const previousRects = capturePanelRects();
  applyDrop(zone, dragCtx.tab, dragCtx.sourcePanelId);
  const enteredPanelId = previousRects.has(activePanelId) ? null : activePanelId;
  statusEl.textContent = `Dropped Box ${dragCtx.tab.num}: ${zone.type} (layer ${zone.layer}${zone.direction ? ` ${zone.direction}` : ""}).`;
  cleanupDragUI();
  renderAndPersistWithDropTransition(previousRects, enteredPanelId);
}

function resolveDropZone(e) {
  const hover = drag.hoverPreview;
  const live = resolveHoverAtPoint(buildPanelInfoMap(root), e.clientX, e.clientY);
  return (hover && hover.zone) || (live && live.zone) || null;
}

function resolveDragCtxFromDropEvent(e) {
  if (drag.dragCtx) return drag.dragCtx;
  const tabId = e.dataTransfer ? e.dataTransfer.getData("text/plain") : "";
  if (!tabId) return null;
  for (const [panelId, info] of buildPanelInfoMap(root).entries()) {
    const tab = info.panel.tabs.find((t) => t.id === tabId);
    if (tab) return { sourcePanelId: panelId, tab: { ...tab } };
  }
  return null;
}

// ── Start drag session ───────────────────────────────────────────────────────

function startDragSession(sourcePanelId, tab, point, statusMessage) {
  drag.dragCtx = { sourcePanelId, tab: { ...tab } };
  ensureDragGhost(`Box ${tab.num}`);
  moveDragGhost(point);
  drag.hoverPreview = null;
  drag.lastDragPoint = point;
  drag.hoverAnchorPoint = null;
  drag.stopPreviewIdleTimer();
  drag.stopDragPreviewTimer();
  if (previewMode === "preview") showPreviewSearchState(point.x, point.y);
  else updateHoverFromPoint(point.x, point.y);
  if (previewMode === "preview" || previewMode === "combined") {
    drag.hoverAnchorPoint = point;
    scheduleIdlePreview();
  }
  statusEl.textContent = statusMessage;
}

// ── Tab event handlers ───────────────────────────────────────────────────────

function onTabDragStart(e) {
  const panelId = e.currentTarget.dataset.panelId;
  const tabId = e.currentTarget.dataset.tabId;
  const found = findNodeById(root, panelId);
  if (!found || found.node.type !== "panel") return;
  const tab = found.node.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", tab.id);
  e.dataTransfer.setDragImage(getTransparentDragImage(), 0, 0);
  startDragSession(panelId, tab, { x: e.clientX, y: e.clientY }, `Dragging Box ${tab.num}. Release in a valid zone to move it.`);
  drag.startDragPreviewTimer(() => {
    if (!drag.dragCtx || !drag.lastDragPoint) return;
    if (previewMode !== "preview" && previewMode !== "combined") updateHoverFromPoint(drag.lastDragPoint.x, drag.lastDragPoint.y);
  }, 70);
}

function onTabDragEnd() {
  setTimeout(() => {
    if (!drag.hasTransientState()) return;
    cleanupDragUI("Drag finished. Create/drag another box to continue testing.", true);
  }, 0);
}

function onCloseTabClick(e, panelId, tabId) {
  e.stopPropagation();
  e.preventDefault();
  const previousRects = capturePanelRects();
  const nextRoot = cloneNode(root);
  const found = findNodeById(nextRoot, panelId);
  if (!found || found.node.type !== "panel") return;
  const panel = found.node;
  const tabIdx = panel.tabs.findIndex((t) => t.id === tabId);
  if (tabIdx === -1) return;
  if (getPanelCount(nextRoot) === 1 && panel.tabs.length === 1) {
    statusEl.textContent = "Cannot remove the last remaining box.";
    return;
  }
  const [removedTab] = panel.tabs.splice(tabIdx, 1);
  if (panel.activeTabId === removedTab.id) panel.activeTabId = panel.tabs[0] ? panel.tabs[0].id : null;
  if (panel.tabs.length === 0) {
    root = removePanelAndCollapse(nextRoot, panelId, createFallbackRoot);
    if (activePanelId === panelId) activePanelId = null;
  } else {
    root = nextRoot;
  }
  cleanupDragUI(null);
  statusEl.textContent = `Removed Box ${removedTab.num}.`;
  renderAndPersistWithDropTransition(previousRects);
}

function onTabClick(e, panelId, tabId) {
  if (e.target.closest(".tab-close")) return;
  e.stopPropagation();
  const nextRoot = cloneNode(root);
  const found = findNodeById(nextRoot, panelId);
  if (!found || found.node.type !== "panel") return;
  if (!found.node.tabs.some((t) => t.id === tabId)) return;
  found.node.activeTabId = tabId;
  root = nextRoot;
  activePanelId = panelId;
  renderAndPersist();
}

// ── Panel event handlers ─────────────────────────────────────────────────────

function onPanelClick(e, panelId) {
  if (e.target.closest(".tab-close")) return;
  if (activePanelId === panelId) return;
  activePanelId = panelId;
  statusEl.textContent = "Active segment selected.";
  renderAndPersist();
}

function onPanelDragOver(e) {
  if (!drag.dragCtx) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  drag.lastDragPoint = { x: e.clientX, y: e.clientY };
  dispatchDragOver(e.clientX, e.clientY);
}

function onPanelDrop(e) {
  const ctx = resolveDragCtxFromDropEvent(e);
  if (!ctx) return;
  e.preventDefault();
  const zone = resolveDropZone(e);
  if (!zone) { statusEl.textContent = "Drop canceled: no valid zone here."; return; }
  if (zone.type === "INVALID") { statusEl.textContent = `Drop blocked: ${zone.reason}`; return; }
  if (!ctx.sourcePanelId && !canCreateAnotherBox()) {
    statusEl.textContent = `Drop blocked: max total box count (${CONFIG.maxTotalBoxCount}) reached.`;
    return;
  }
  commitDrop(zone, ctx);
}

// ── Workspace drag/drop handlers ─────────────────────────────────────────────

function onWorkspaceDragOver(e) {
  if (!drag.dragCtx || !drag.dragCtx.sourcePanelId) return;
  if (e.target.closest(".panel[data-panel-id]")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  drag.lastDragPoint = { x: e.clientX, y: e.clientY };
  dispatchDragOver(e.clientX, e.clientY);
}

function onWorkspaceDrop(e) {
  const ctx = resolveDragCtxFromDropEvent(e);
  if (!ctx || !ctx.sourcePanelId) return;
  if (e.target.closest(".panel[data-panel-id]")) return;
  e.preventDefault();
  const zone = resolveDropZone(e);
  if (!zone) { statusEl.textContent = "Drop canceled: no valid zone here."; return; }
  if (zone.type === "INVALID") { statusEl.textContent = `Drop blocked: ${zone.reason}`; return; }
  commitDrop(zone, ctx);
}

// ── Create button ────────────────────────────────────────────────────────────

const CREATE_HOLD_MS = 160;
const CREATE_DRAG_PX = 6;
let createButtonPress = null;
let suppressNextCreateClick = false;

function cancelCreateButtonPress() {
  if (!createButtonPress) return;
  if (createButtonPress.holdTimer) clearTimeout(createButtonPress.holdTimer);
  createButtonPress = null;
}

function createBoxInActiveSegment() {
  if (!canCreateAnotherBox()) {
    statusEl.textContent = `Cannot create more boxes: max total box count is ${CONFIG.maxTotalBoxCount}.`;
    return;
  }
  const tab = createBoxTab();
  const activeFound = activePanelId ? findNodeById(root, activePanelId) : null;
  const panel = activeFound && activeFound.node.type === "panel" ? activeFound.node : null;
  if (panel) {
    panel.tabs.push(tab);
    panel.activeTabId = tab.id;
    activePanelId = panel.id;
    statusEl.textContent = `Created Box ${tab.num}. Added as a tab in the active segment.`;
  } else {
    const first = getFirstPanel(root);
    if (!first) { root = createPanelNode(tab); activePanelId = root.id; }
    else { first.tabs.push(tab); first.activeTabId = tab.id; activePanelId = first.id; }
    statusEl.textContent = `Created Box ${tab.num}. Added to the first segment (no active segment selected).`;
  }
  renderAndPersist();
}

function beginCreateButtonDrag(point) {
  if (!canCreateAnotherBox()) {
    statusEl.textContent = `Cannot create more boxes: max total box count is ${CONFIG.maxTotalBoxCount}.`;
    return;
  }
  const tab = createBoxTab();
  startDragSession(null, tab, point, `Dragging new Box ${tab.num}. Release in a valid zone to create it there.`);
  suppressNextCreateClick = true;
}

function finishCreateButtonPointer(point) {
  if (!createButtonPress) return;
  const wasDrag = createButtonPress.startedDrag;
  cancelCreateButtonPress();
  if (!wasDrag) return;
  const hover = resolveHoverAtPoint(buildPanelInfoMap(root), point.x, point.y);
  const ctx = drag.dragCtx;
  if (!hover || !hover.zone || !ctx) { cleanupDragUI("Create canceled: release over a valid panel zone to place the new box.", true); return; }
  if (hover.zone.type === "INVALID") { cleanupDragUI(`Create blocked: ${hover.zone.reason}`, true); return; }
  if (!canCreateAnotherBox()) { cleanupDragUI(`Create blocked: max total box count (${CONFIG.maxTotalBoxCount}) reached.`, true); return; }
  const previousRects = capturePanelRects();
  applyDrop(hover.zone, ctx.tab, ctx.sourcePanelId);
  const enteredPanelId = previousRects.has(activePanelId) ? null : activePanelId;
  statusEl.textContent = `Created Box ${ctx.tab.num}: ${hover.zone.type} (layer ${hover.zone.layer}${hover.zone.direction ? ` ${hover.zone.direction}` : ""}).`;
  cleanupDragUI();
  renderAndPersistWithDropTransition(previousRects, enteredPanelId);
}

function cancelCreateDragIfStarted(message) {
  if (!createButtonPress) return;
  const wasDrag = createButtonPress.startedDrag;
  cancelCreateButtonPress();
  if (wasDrag) cleanupDragUI(message, true);
}

createBtn.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !e.isPrimary) return;
  if (!canCreateAnotherBox()) {
    statusEl.textContent = `Cannot create more boxes: max total box count is ${CONFIG.maxTotalBoxCount}.`;
    return;
  }
  cancelCreateButtonPress();
  createButtonPress = {
    pointerId: e.pointerId, holdElapsed: false, startedDrag: false,
    startPoint: { x: e.clientX, y: e.clientY }, lastPoint: { x: e.clientX, y: e.clientY },
    holdTimer: setTimeout(() => {
      if (!createButtonPress || createButtonPress.pointerId !== e.pointerId) return;
      createButtonPress.holdElapsed = true;
    }, CREATE_HOLD_MS)
  };
  createBtn.setPointerCapture(e.pointerId);
});

createBtn.addEventListener("pointermove", (e) => {
  if (!createButtonPress || createButtonPress.pointerId !== e.pointerId) return;
  const point = { x: e.clientX, y: e.clientY };
  createButtonPress.lastPoint = point;
  if (!createButtonPress.startedDrag) {
    const dist = Math.hypot(point.x - createButtonPress.startPoint.x, point.y - createButtonPress.startPoint.y);
    if (!createButtonPress.holdElapsed && dist < CREATE_DRAG_PX) return;
    createButtonPress.startedDrag = true;
    beginCreateButtonDrag(point);
  }
  moveDragGhost(point);
  drag.lastDragPoint = point;
  dispatchDragOver(point.x, point.y);
});

createBtn.addEventListener("pointerup", (e) => {
  if (!createButtonPress || createButtonPress.pointerId !== e.pointerId) return;
  finishCreateButtonPointer({ x: e.clientX, y: e.clientY });
});

createBtn.addEventListener("pointercancel", (e) => {
  if (!createButtonPress || createButtonPress.pointerId !== e.pointerId) return;
  cancelCreateDragIfStarted("Create canceled.");
});

createBtn.addEventListener("lostpointercapture", () => cancelCreateDragIfStarted("Create canceled."));

createBtn.addEventListener("click", () => {
  if (suppressNextCreateClick) { suppressNextCreateClick = false; return; }
  createBoxInActiveSegment();
});

// ── View mode button ─────────────────────────────────────────────────────────

function updateViewModeButton() {
  const labels = { hitbox: "Mode: Hitbox", preview: "Mode: Preview", combined: "Mode: Combined" };
  viewModeBtn.textContent = labels[previewMode] || labels.hitbox;
}

const syncResizeAffordance = () => {
  workspaceEl.dataset.resizeAffordance = (previewMode === "hitbox" || previewMode === "combined") ? "circles" : "cursor-only";
};

viewModeBtn.addEventListener("click", () => {
  const idx = VIEW_MODES.indexOf(previewMode);
  previewMode = VIEW_MODES[((idx === -1 ? 0 : idx) + 1) % VIEW_MODES.length];
  updateViewModeButton();
  syncResizeAffordance();

  const msgs = {
    hitbox: { drag: "Hitbox mode enabled. Showing raw hit zones while dragging.", idle: "Hitbox mode enabled. Drag tabs to inspect drop zones." },
    preview: { drag: "Preview mode enabled. Hitboxes stay hidden while moving; pause briefly to see the drop preview.", idle: "Preview mode enabled. While dragging: move without hitboxes, then pause briefly for a live drop preview." },
    combined: { drag: "Combined mode enabled. Hitboxes always visible; pause to see a softer preview overlay.", idle: "Combined mode enabled. Hitboxes always visible. Drag tabs to see drop zones and pause for a preview overlay." }
  };

  if (drag.dragCtx && drag.lastDragPoint) {
    drag.stopPreviewIdleTimer();
    drag.hoverAnchorPoint = drag.lastDragPoint;
    clearDropPreviewLayer();
    const overlay = document.getElementById("workspaceOverlay");
    if (overlay) overlay.classList.remove("faded");
    if (previewMode === "preview") showPreviewSearchState(drag.lastDragPoint.x, drag.lastDragPoint.y);
    else updateHoverFromPoint(drag.lastDragPoint.x, drag.lastDragPoint.y);
    if (previewMode === "preview" || previewMode === "combined") scheduleIdlePreview();
    statusEl.textContent = (msgs[previewMode] || msgs.hitbox).drag;
  } else {
    statusEl.textContent = (msgs[previewMode] || msgs.hitbox).idle;
  }
  syncOverlayForCurrentMode();
  persistence.save({ root, activePanelId, previewMode, idCounter, panelCounter });
});

// ── Reset button ─────────────────────────────────────────────────────────────

resetBtn.addEventListener("click", () => {
  resize.cancelActiveResize();
  idCounter = 1;
  panelCounter = 1;
  root = createPanelNode(createBoxTab());
  activePanelId = root.id;
  previewMode = CONFIG.defaultPreviewMode;
  drag.resetDragSession();
  persistence.clear();
  updateViewModeButton();
  syncResizeAffordance();
  statusEl.textContent = "Layout reset to one panel with one box.";
  renderAndPersist();
});

// ── Window-level event listeners ─────────────────────────────────────────────

window.addEventListener("dragend", () => {
  if (!drag.hasTransientState()) return;
  cleanupDragUI("Drag canceled/reset.", true);
});

window.addEventListener("dragover", (e) => {
  if (!drag.dragCtx || !drag.dragCtx.sourcePanelId) return;
  const pt = { x: e.clientX, y: e.clientY };
  moveDragGhost(pt);
  drag.lastDragPoint = pt;
});

window.addEventListener("drop", () => {
  if (!drag.hasTransientState()) return;
  cleanupDragUI(null, true);
});

window.addEventListener("pointermove", (e) => resize.onResizePointerMove(e));
window.addEventListener("pointerup", (e) => resize.onResizePointerUp(e));
window.addEventListener("pointercancel", (e) => resize.onResizePointerCancel(e));

let resizeFrameHandle = null;
window.addEventListener("resize", () => {
  if (resizeFrameHandle) return;
  resizeFrameHandle = requestAnimationFrame(() => {
    resizeFrameHandle = null;
    applyRuntimeStyleConfig();
    if (!drag.dragCtx || !drag.lastDragPoint) { syncOverlayForCurrentMode(); return; }
    drag.stopPreviewIdleTimer();
    clearDropPreviewLayer();
    drag.hoverPreview = null;
    if (previewMode === "hitbox" || previewMode === "combined") updateHoverFromPoint(drag.lastDragPoint.x, drag.lastDragPoint.y);
    else showPreviewSearchState(drag.lastDragPoint.x, drag.lastDragPoint.y);
    if (previewMode !== "hitbox") scheduleIdlePreview();
  });
});

workspaceEl.addEventListener("dragover", onWorkspaceDragOver);
workspaceEl.addEventListener("drop", onWorkspaceDrop);
workspaceEl.addEventListener("pointerdown", (e) => resize.onWorkspacePointerDown(e));

// ── Initial render ───────────────────────────────────────────────────────────

updateViewModeButton();
syncResizeAffordance();
renderAndPersist();
