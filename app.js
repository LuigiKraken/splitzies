const DEFAULT_CONFIG = {
  centerFraction: 0.24,
  minBandPx: 20,
  maxDepth: 6,
  minBoxWidthPx: 100,
  minBoxHeightPx: 100,
  maxTotalBoxCount: 30,
  maxHorizontalStack: 6,
  maxVerticalStack: 6,
  previewIdleMs: 500,
  previewMoveThresholdPx: 4,
  allowTabStripStackZone: false
};

function asPositiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function asPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeConfig(raw) {
  const input = (raw && typeof raw === "object") ? raw : {};
  return {
    centerFraction: asPositiveNumber(input.centerFraction, DEFAULT_CONFIG.centerFraction),
    minBandPx: asPositiveNumber(input.minBandPx, DEFAULT_CONFIG.minBandPx),
    maxDepth: asPositiveInt(input.maxDepth, DEFAULT_CONFIG.maxDepth),
    minBoxWidthPx: asPositiveInt(input.minBoxWidthPx, DEFAULT_CONFIG.minBoxWidthPx),
    minBoxHeightPx: asPositiveInt(input.minBoxHeightPx, DEFAULT_CONFIG.minBoxHeightPx),
    maxTotalBoxCount: asPositiveInt(input.maxTotalBoxCount, DEFAULT_CONFIG.maxTotalBoxCount),
    maxHorizontalStack: asPositiveInt(input.maxHorizontalStack, DEFAULT_CONFIG.maxHorizontalStack),
    maxVerticalStack: asPositiveInt(input.maxVerticalStack, DEFAULT_CONFIG.maxVerticalStack),
    previewIdleMs: asPositiveInt(input.previewIdleMs, DEFAULT_CONFIG.previewIdleMs),
    previewMoveThresholdPx: asPositiveNumber(input.previewMoveThresholdPx, DEFAULT_CONFIG.previewMoveThresholdPx),
    allowTabStripStackZone: asBoolean(input.allowTabStripStackZone, DEFAULT_CONFIG.allowTabStripStackZone)
  };
}

const CONFIG = normalizeConfig(window.DOCK_CONFIG);
const layoutModel = window.LayoutModel;
if (!layoutModel) {
  throw new Error("Missing LayoutModel. Ensure layoutModel.js is loaded before app.js.");
}
const {
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
} = layoutModel;

let idCounter = 1;
let panelCounter = 1;
let root = createPanelNode(createBoxTab());
let activePanelId = root.id;
const DEFAULT_PREVIEW_MODE = "preview";
const STORAGE_SCHEMA_VERSION = 1;
const LAYOUT_STORAGE_KEY = `dock-layout-state-v${STORAGE_SCHEMA_VERSION}`;
let previewMode = DEFAULT_PREVIEW_MODE;

const CREATE_BUTTON_HOLD_MS = 160;
const CREATE_BUTTON_DRAG_START_PX = 6;

const workspaceEl = document.getElementById("workspace");
const statusEl = document.getElementById("status");
const treeViewEl = document.getElementById("treeView");
const createBtn = document.getElementById("createBtn");
const resetBtn = document.getElementById("resetBtn");
const viewModeBtn = document.getElementById("viewModeBtn");
const actionColors = {
  STACK: "rgba(110, 231, 255, 0.30)",
  SPLIT: "rgba(255, 217, 97, 0.22)",
  EQUALIZE: "rgba(123, 255, 155, 0.22)",
  WRAP: "rgba(255, 136, 222, 0.22)",
  INVALID: "rgba(255, 123, 123, 0.16)"
};
let createButtonPress = null;
let suppressNextCreateClick = false;
let dragGhostEl = null;
let transparentDragImageEl = null;

const PREVIEW_IDLE_MS = CONFIG.previewIdleMs;
const PREVIEW_MOVE_THRESHOLD_PX = CONFIG.previewMoveThresholdPx;
const dragControllerApi = window.DragController;
if (!dragControllerApi) {
  throw new Error("Missing DragController. Ensure dragController.js is loaded before app.js.");
}
const dragController = dragControllerApi.create({
  previewMoveThresholdPx: PREVIEW_MOVE_THRESHOLD_PX
});
const getDragCtx = () => dragController.getDragCtx();
const setDragCtx = (value) => dragController.setDragCtx(value);
const getHoverPreview = () => dragController.getHoverPreview();
const getLastDragPoint = () => dragController.getLastDragPoint();
const setLastDragPoint = (value) => dragController.setLastDragPoint(value);

function formatZoneSummary(zone, includeTarget = false) {
  if (!zone) return "";
  const target = includeTarget && zone.targetId ? ` target=${zone.targetId}` : "";
  const direction = zone.direction ? ` dir=${zone.direction}` : "";
  return `${zone.type} | layer=${zone.layer}${direction}${target}`;
}

function setMaxBoxCountReachedStatus() {
  statusEl.textContent = `Cannot create more boxes: max total box count is ${CONFIG.maxTotalBoxCount}.`;
}

function applyRuntimeStyleConfig() {
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--min-box-width-px", `${CONFIG.minBoxWidthPx}px`);
  rootStyle.setProperty("--min-box-height-px", `${CONFIG.minBoxHeightPx}px`);
}

applyRuntimeStyleConfig();

function nextId(prefix) {
  return `${prefix}-${idCounter++}`;
}

function createBoxTab() {
  const boxNumber = panelCounter++;
  return {
    id: nextId("tab"),
    num: boxNumber
  };
}

function createPanelNode(initialTab) {
  return {
    type: "panel",
    id: nextId("panel"),
    tabs: [initialTab],
    activeTabId: initialTab.id
  };
}

function createContainer(axis, children) {
  const size = 1 / children.length;
  return {
    type: "container",
    id: nextId("container"),
    axis,
    sizes: children.map(() => size),
    children
  };
}

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

function persistLayoutState() {
  const payload = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    root,
    activePanelId,
    previewMode,
    idCounter,
    panelCounter
  };
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // Ignore storage write failures (e.g., privacy mode or quota exceeded).
  }
}

function clearPersistedLayoutState() {
  try {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
  } catch (err) {
    // Ignore storage clear failures; reset still applies in memory.
  }
}

function restorePersistedLayoutState() {
  let parsed = null;
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return false;
    parsed = JSON.parse(raw);
  } catch (err) {
    return false;
  }

  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.schemaVersion !== STORAGE_SCHEMA_VERSION) return false;
  if (!isValidNode(parsed.root)) return false;
  if (!getFirstPanel(parsed.root)) return false;

  root = parsed.root;
  previewMode = parsed.previewMode === "hitbox" ? "hitbox" : DEFAULT_PREVIEW_MODE;
  activePanelId = typeof parsed.activePanelId === "string" ? parsed.activePanelId : null;

  const stats = collectTreeStats(root);
  idCounter = Math.max(safePositiveInt(parsed.idCounter, 1), stats.maxIdNumber + 1);
  panelCounter = Math.max(safePositiveInt(parsed.panelCounter, 1), stats.maxBoxNumber + 1);

  const activeFound = activePanelId ? findNodeById(root, activePanelId) : null;
  if (!activeFound || activeFound.node.type !== "panel") {
    const firstPanel = getFirstPanel(root);
    activePanelId = firstPanel ? firstPanel.id : null;
  }

  return true;
}

restorePersistedLayoutState();

function axisStackLimit(axis) {
  return axis === "column" ? CONFIG.maxHorizontalStack : CONFIG.maxVerticalStack;
}

function canAddSiblingToAxis(axis, nextSiblingCount) {
  return nextSiblingCount <= axisStackLimit(axis);
}

function canCreateAnotherBox() {
  return getTotalBoxCount(root) < CONFIG.maxTotalBoxCount;
}

const dropZonesApi = window.DropZones;
if (!dropZonesApi) {
  throw new Error("Missing DropZones. Ensure dropZones.js is loaded before app.js.");
}
const { resolveHoverAtPoint, drawZonesForWorkspace } = dropZonesApi.create({
  config: CONFIG,
  canAddSiblingToAxis,
  axisForDirection,
  isAlongAxis,
  isBeforeDirection,
  workspaceEl,
  actionColors,
  getNodeElementById: (id) => document.querySelector(`[data-node-id="${id}"]`),
  getRoot: () => root,
  findNodeById
});

const dropActionsApi = window.DropActions;
if (!dropActionsApi) {
  throw new Error("Missing DropActions. Ensure dropActions.js is loaded before app.js.");
}
function createDropExecutor(runtime) {
  return dropActionsApi.create({
    getRoot: runtime.getRoot,
    setRoot: runtime.setRoot,
    setActivePanelId: runtime.setActivePanelId,
    cloneNode,
    findNodeById,
    removePanelAndCollapse,
    canCreateAnotherBox: runtime.canCreateAnotherBox,
    createBoxTab: runtime.createBoxTab,
    createPanelNode: runtime.createPanelNode,
    createContainer: runtime.createContainer,
    createFallbackRoot: runtime.createFallbackRoot,
    axisForDirection,
    isBeforeDirection,
    clamp: (v, min, max) => Math.max(min, Math.min(max, v))
  });
}

const { executeDrop } = createDropExecutor({
  getRoot: () => root,
  setRoot: (nextRoot) => { root = nextRoot; },
  setActivePanelId: (panelId) => { activePanelId = panelId; },
  canCreateAnotherBox,
  createBoxTab,
  createPanelNode,
  createContainer,
  createFallbackRoot: () => createPanelNode(createBoxTab())
});

const rendererApi = window.DockRenderer;
if (!rendererApi) {
  throw new Error("Missing DockRenderer. Ensure render.js is loaded before app.js.");
}
const {
  render,
  renderPreviewTree,
  clearDropPreviewLayer,
  clearDragOverlay
} = rendererApi.create({
  workspaceEl,
  treeViewEl,
  panelTreeString,
  buildPanelInfoMap,
  findNodeById,
  getRoot: () => root,
  getActivePanelId: () => activePanelId,
  setActivePanelId: (panelId) => { activePanelId = panelId; },
  handlers: {
    onCloseTabClick,
    onTabClick,
    onTabDragStart,
    onTabDragEnd,
    onPanelClick,
    onPanelDragOver,
    onPanelDrop
  }
});

function renderAndPersist() {
  render();
  persistLayoutState();
}

function removeDragGhost() {
  if (!dragGhostEl) return;
  dragGhostEl.remove();
  dragGhostEl = null;
}

function ensureDragGhost(label) {
  removeDragGhost();
  const ghost = document.createElement("div");
  ghost.className = "create-drag-ghost";
  ghost.textContent = label;
  document.body.appendChild(ghost);
  dragGhostEl = ghost;
}

function moveDragGhost(point) {
  if (!dragGhostEl) return;
  const x = point.x + 14;
  const y = point.y + 14;
  dragGhostEl.style.transform = `translate(${x}px, ${y}px)`;
}

function getTransparentDragImage() {
  if (transparentDragImageEl) return transparentDragImageEl;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  transparentDragImageEl = canvas;
  return transparentDragImageEl;
}

function buildDropPreviewTree(zone) {
  const dragCtx = getDragCtx();
  if (!dragCtx || !zone) return null;

  const previewState = {
    root: cloneNode(root),
    activePanelId
  };
  let previewIdCounter = idCounter;
  let previewPanelCounter = panelCounter;
  const nextPreviewId = (prefix) => `${prefix}-${previewIdCounter++}`;
  const createPreviewBoxTab = () => ({
    id: nextPreviewId("tab"),
    num: previewPanelCounter++
  });
  const createPreviewPanelNode = (initialTab) => ({
    type: "panel",
    id: nextPreviewId("panel"),
    tabs: [initialTab],
    activeTabId: initialTab.id
  });
  const createPreviewContainer = (axis, children) => {
    const size = 1 / children.length;
    return {
      type: "container",
      id: nextPreviewId("container"),
      axis,
      sizes: children.map(() => size),
      children
    };
  };

  const { executeDrop: executePreviewDrop } = createDropExecutor({
    getRoot: () => previewState.root,
    setRoot: (nextRoot) => { previewState.root = nextRoot; },
    setActivePanelId: (panelId) => { previewState.activePanelId = panelId; },
    canCreateAnotherBox: () => getTotalBoxCount(previewState.root) < CONFIG.maxTotalBoxCount,
    createBoxTab: createPreviewBoxTab,
    createPanelNode: createPreviewPanelNode,
    createContainer: createPreviewContainer,
    createFallbackRoot: () => createPreviewPanelNode(createPreviewBoxTab())
  });

  executePreviewDrop(zone, dragCtx.tab, dragCtx.sourcePanelId);
  return cloneNode(previewState.root);
}

function showDropPreview(zone) {
  const previewLayer = document.getElementById("workspacePreview");
  if (!previewLayer) return;
  const previewTree = buildDropPreviewTree(zone);
  if (!previewTree) return;
  const treeDom = renderPreviewTree(previewTree);
  treeDom.style.width = "100%";
  treeDom.style.height = "100%";
  previewLayer.innerHTML = "";
  previewLayer.appendChild(treeDom);
  previewLayer.classList.add("active");
  workspaceEl.classList.add("previewing");
  dragController.setDragVisualState("preview");
}

function scheduleIdlePreview() {
  dragController.schedulePreviewIdle(() => {
    const dragCtx = getDragCtx();
    const lastDragPoint = getLastDragPoint();
    if (!dragCtx || previewMode !== "preview" || !lastDragPoint) return;
    const panelInfoMap = buildPanelInfoMap(root);
    const hover = resolveHoverAtPoint(panelInfoMap, lastDragPoint.x, lastDragPoint.y);
    if (!hover || !hover.zone) return;
    if (hover.zone.type === "INVALID") {
      statusEl.textContent = `Preview blocked: ${hover.zone.reason}`;
      return;
    }
    dragController.setHoverPreview({
      panelId: hover.panelId || null,
      depth: hover.info ? hover.info.depth : null,
      zone: hover.zone
    });
    clearDragOverlay();
    showDropPreview(hover.zone);
    statusEl.textContent = `Preview: ${formatZoneSummary(hover.zone, true)}. Hold still to inspect, move to continue searching.`;
  }, PREVIEW_IDLE_MS);
}

function showHitboxStateAtPoint(x, y) {
  clearDropPreviewLayer();
  dragController.setDragVisualState("hitbox");
  dragController.setHoverPreview(null);
  clearDragOverlay();
  const panelInfoMap = buildPanelInfoMap(root);
  const hover = resolveHoverAtPoint(panelInfoMap, x, y);
  if (!hover) {
    statusEl.textContent = "Move over a panel and hold still to see drop preview.";
    return;
  }
  if (!hover.zone) {
    statusEl.textContent = "No valid drop zone here. Move and hold in another spot.";
    return;
  }
  if (hover.zone.type === "INVALID") {
    statusEl.textContent = `Blocked by limits: ${hover.zone.reason}`;
    return;
  }
  statusEl.textContent = "Hold still briefly to show drop preview. Move to keep searching.";
}

function handlePreviewModeDragOver(x, y) {
  dragController.handlePreviewModeDragOver(x, y, () => {
    showHitboxStateAtPoint(x, y);
    scheduleIdlePreview();
  });
}

function updateViewModeButton() {
  viewModeBtn.textContent = previewMode === "hitbox" ? "Mode: Hitbox" : "Mode: Preview";
  viewModeBtn.setAttribute(
    "aria-label",
    previewMode === "hitbox"
      ? "Switch to preview mode"
      : "Switch to hitbox mode"
  );
}

function cleanupDragUI(message = null, shouldRender = false) {
  dragController.resetDragSession();
  removeDragGhost();
  clearDragOverlay();
  if (message) statusEl.textContent = message;
  if (shouldRender) renderAndPersist();
}

function updateHoverFromPoint(x, y) {
  if (!getDragCtx()) return;
  const panelInfoMap = buildPanelInfoMap(root);
  const hover = resolveHoverAtPoint(panelInfoMap, x, y);
  if (!hover) {
    dragController.setHoverPreview(null);
    clearDragOverlay();
    statusEl.textContent = "Move over a panel to preview drop zones.";
    return;
  }

  dragController.setHoverPreview({
    panelId: hover.panelId || null,
    depth: hover.info ? hover.info.depth : null,
    zone: hover.zone
  });
  drawZonesForWorkspace(panelInfoMap, hover.zone, hover.panelId);

  if (hover.zone) {
    if (hover.zone.type === "INVALID") {
      statusEl.textContent = `Preview blocked: ${hover.zone.reason}`;
    } else {
      statusEl.textContent = `Preview: ${formatZoneSummary(hover.zone, true)}. ${hover.zone.reason}`;
    }
  } else {
    statusEl.textContent = "Preview: no-op (panel too small or invalid layer).";
  }
}

function resolveDragCtxFromDropEvent(e) {
  const ctx = getDragCtx();
  if (ctx) return ctx;
  const tabId = e.dataTransfer ? e.dataTransfer.getData("text/plain") : "";
  if (!tabId) return null;
  const panelInfoMap = buildPanelInfoMap(root);
  for (const [panelId, info] of panelInfoMap.entries()) {
    if (!info || !info.panel || !Array.isArray(info.panel.tabs)) continue;
    const tab = info.panel.tabs.find((t) => t.id === tabId);
    if (tab) {
      return { sourcePanelId: panelId, tab: { ...tab } };
    }
  }
  return null;
}

function startDragSession(sourcePanelId, tab, point, statusMessage) {
  setDragCtx({ sourcePanelId, tab: { ...tab } });
  ensureDragGhost(`Box ${tab.num}`);
  moveDragGhost(point);
  dragController.setHoverPreview(null);
  setLastDragPoint(point);
  dragController.setDragVisualState("hitbox");
  dragController.setHoverAnchorPoint(null);
  dragController.stopPreviewIdleTimer();
  dragController.stopDragPreviewTimer();
  updateHoverFromPoint(point.x, point.y);
  if (previewMode === "preview") {
    dragController.setHoverAnchorPoint(point);
    scheduleIdlePreview();
  }
  statusEl.textContent = statusMessage;
}

function onTabDragStart(e) {
  const panelId = e.currentTarget.dataset.panelId;
  const tabId = e.currentTarget.dataset.tabId;
  const panelFound = findNodeById(root, panelId);
  if (!panelFound || panelFound.node.type !== "panel") return;
  const tab = panelFound.node.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", tab.id);
  e.dataTransfer.setDragImage(getTransparentDragImage(), 0, 0);
  startDragSession(
    panelId,
    tab,
    { x: e.clientX, y: e.clientY },
    `Dragging Box ${tab.num}. Release in a valid zone to move it.`
  );

  dragController.startDragPreviewTimer(() => {
    const dragCtx = getDragCtx();
    const lastDragPoint = getLastDragPoint();
    if (!dragCtx || !lastDragPoint) return;
    if (previewMode !== "preview") {
      updateHoverFromPoint(lastDragPoint.x, lastDragPoint.y);
    }
  }, 70);
}

function onTabDragEnd() {
  // Some browsers can dispatch dragend before drop handlers settle.
  // Delay cleanup so a valid drop can consume drag state first.
  window.setTimeout(() => {
    if (!dragController.hasTransientState()) return;
    cleanupDragUI("Drag finished. Create/drag another box to continue testing.", true);
  }, 0);
}

function onCloseTabClick(e, panelId, tabId) {
  e.stopPropagation();
  e.preventDefault();

  const nextRoot = cloneNode(root);
  const panelFound = findNodeById(nextRoot, panelId);
  if (!panelFound || panelFound.node.type !== "panel") return;

  const panel = panelFound.node;
  const tabIdx = panel.tabs.findIndex((t) => t.id === tabId);
  if (tabIdx === -1) return;

  const totalPanels = getPanelCount(nextRoot);
  const isOnlyBoxInOnlyPanel = totalPanels === 1 && panel.tabs.length === 1;
  if (isOnlyBoxInOnlyPanel) {
    statusEl.textContent = "Cannot remove the last remaining box.";
    return;
  }

  const [removedTab] = panel.tabs.splice(tabIdx, 1);
  if (panel.activeTabId === removedTab.id) {
    panel.activeTabId = panel.tabs[0] ? panel.tabs[0].id : null;
  }

  if (panel.tabs.length === 0) {
    root = removePanelAndCollapse(nextRoot, panelId, () => createPanelNode(createBoxTab()));
    if (activePanelId === panelId) activePanelId = null;
  } else {
    root = nextRoot;
  }

  cleanupDragUI(null);
  statusEl.textContent = `Removed Box ${removedTab.num}.`;
  renderAndPersist();
}

function onPanelDragOver(e) {
  if (!getDragCtx()) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  setLastDragPoint({ x: e.clientX, y: e.clientY });
  if (previewMode === "hitbox") {
    updateHoverFromPoint(e.clientX, e.clientY);
  } else {
    handlePreviewModeDragOver(e.clientX, e.clientY);
  }
}

function onPanelClick(e, panelId) {
  if (e.target.closest(".tab-close")) return;
  if (activePanelId === panelId) return;
  activePanelId = panelId;
  statusEl.textContent = "Active segment selected.";
  renderAndPersist();
}

function onTabClick(e, panelId, tabId) {
  if (e.target.closest(".tab-close")) return;
  e.stopPropagation();
  const nextRoot = cloneNode(root);
  const panelFound = findNodeById(nextRoot, panelId);
  if (!panelFound || panelFound.node.type !== "panel") return;
  const tabExists = panelFound.node.tabs.some((t) => t.id === tabId);
  if (!tabExists) return;
  panelFound.node.activeTabId = tabId;
  root = nextRoot;
  activePanelId = panelId;
  renderAndPersist();
}

function onPanelDrop(e) {
  const dragCtx = resolveDragCtxFromDropEvent(e);
  if (!dragCtx) return;
  e.preventDefault();

  const hoverPreview = getHoverPreview();
  const panelInfoMap = buildPanelInfoMap(root);
  const hover = resolveHoverAtPoint(panelInfoMap, e.clientX, e.clientY);
  const zone = (hoverPreview && hoverPreview.zone) || (hover && hover.zone) || null;
  if (!zone) {
    statusEl.textContent = "Drop canceled: no valid zone here.";
    return;
  }
  if (zone.type === "INVALID") {
    statusEl.textContent = `Drop blocked: ${zone.reason}`;
    return;
  }
  if (!dragCtx.sourcePanelId && !canCreateAnotherBox()) {
    statusEl.textContent = `Drop blocked: max total box count (${CONFIG.maxTotalBoxCount}) reached.`;
    return;
  }

  executeDrop(zone, dragCtx.tab, dragCtx.sourcePanelId);
  statusEl.textContent = `Dropped Box ${dragCtx.tab.num}: ${zone.type} (layer ${zone.layer}${zone.direction ? ` ${zone.direction}` : ""}).`;
  cleanupDragUI();
  renderAndPersist();
}

function onWorkspaceDragOver(e) {
  const dragCtx = getDragCtx();
  if (!dragCtx || !dragCtx.sourcePanelId) return;
  if (e.target.closest(".panel[data-panel-id]")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  setLastDragPoint({ x: e.clientX, y: e.clientY });
  if (previewMode === "hitbox") {
    updateHoverFromPoint(e.clientX, e.clientY);
  } else {
    handlePreviewModeDragOver(e.clientX, e.clientY);
  }
}

function onWorkspaceDrop(e) {
  const dragCtx = resolveDragCtxFromDropEvent(e);
  if (!dragCtx || !dragCtx.sourcePanelId) return;
  if (e.target.closest(".panel[data-panel-id]")) return;
  e.preventDefault();

  const hoverPreview = getHoverPreview();
  const panelInfoMap = buildPanelInfoMap(root);
  const hover = resolveHoverAtPoint(panelInfoMap, e.clientX, e.clientY);
  const zone = (hoverPreview && hoverPreview.zone) || (hover && hover.zone) || null;
  if (!zone) {
    statusEl.textContent = "Drop canceled: no valid zone here.";
    return;
  }
  if (zone.type === "INVALID") {
    statusEl.textContent = `Drop blocked: ${zone.reason}`;
    return;
  }

  executeDrop(zone, dragCtx.tab, dragCtx.sourcePanelId);
  statusEl.textContent = `Dropped Box ${dragCtx.tab.num}: ${zone.type} (layer ${zone.layer}${zone.direction ? ` ${zone.direction}` : ""}).`;
  cleanupDragUI();
  renderAndPersist();
}

function createBoxInActiveSegment() {
  if (!canCreateAnotherBox()) {
    setMaxBoxCountReachedStatus();
    return;
  }
  const tab = createBoxTab();

  const activeFound = activePanelId ? findNodeById(root, activePanelId) : null;
  const activePanel = activeFound && activeFound.node.type === "panel" ? activeFound.node : null;

  if (activePanel) {
    activePanel.tabs.push(tab);
    activePanel.activeTabId = tab.id;
    activePanelId = activePanel.id;
    statusEl.textContent = `Created Box ${tab.num}. Added as a tab in the active segment.`;
  } else {
    const firstPanel = getFirstPanel(root);
    if (!firstPanel) {
      root = createPanelNode(tab);
      activePanelId = root.id;
    } else {
      firstPanel.tabs.push(tab);
      firstPanel.activeTabId = tab.id;
      activePanelId = firstPanel.id;
    }
    statusEl.textContent = `Created Box ${tab.num}. Added to the first segment (no active segment selected).`;
  }

  renderAndPersist();
}

function cancelCreateButtonPress() {
  if (!createButtonPress) return;
  if (createButtonPress.holdTimer) {
    clearTimeout(createButtonPress.holdTimer);
  }
  createButtonPress = null;
}

function beginCreateButtonDrag(point) {
  if (!canCreateAnotherBox()) {
    setMaxBoxCountReachedStatus();
    return;
  }
  const tab = createBoxTab();
  startDragSession(
    null,
    tab,
    point,
    `Dragging new Box ${tab.num}. Release in a valid zone to create it there.`
  );
  suppressNextCreateClick = true;
}

function updateCreateButtonPointer(point) {
  if (!createButtonPress) return;
  createButtonPress.lastPoint = point;
  if (!createButtonPress.startedDrag) {
    const distance = Math.hypot(point.x - createButtonPress.startPoint.x, point.y - createButtonPress.startPoint.y);
    if (!createButtonPress.holdElapsed && distance < CREATE_BUTTON_DRAG_START_PX) {
      return;
    }
    createButtonPress.startedDrag = true;
    beginCreateButtonDrag(point);
  }
  moveDragGhost(point);
  setLastDragPoint(point);
  if (previewMode === "hitbox") {
    updateHoverFromPoint(point.x, point.y);
  } else {
    handlePreviewModeDragOver(point.x, point.y);
  }
}

function finishCreateButtonPointer(point) {
  if (!createButtonPress) return;
  const wasDrag = createButtonPress.startedDrag;
  cancelCreateButtonPress();
  if (!wasDrag) return;

  const panelInfoMap = buildPanelInfoMap(root);
  const hover = resolveHoverAtPoint(panelInfoMap, point.x, point.y);
  const dragCtx = getDragCtx();
  if (!hover || !hover.zone || !dragCtx) {
    cleanupDragUI("Create canceled: release over a valid panel zone to place the new box.", true);
    return;
  }
  if (hover.zone.type === "INVALID") {
    cleanupDragUI(`Create blocked: ${hover.zone.reason}`, true);
    return;
  }
  if (!canCreateAnotherBox()) {
    cleanupDragUI(`Create blocked: max total box count (${CONFIG.maxTotalBoxCount}) reached.`, true);
    return;
  }

  executeDrop(hover.zone, dragCtx.tab, dragCtx.sourcePanelId);
  statusEl.textContent = `Created Box ${dragCtx.tab.num}: ${hover.zone.type} (layer ${hover.zone.layer}${hover.zone.direction ? ` ${hover.zone.direction}` : ""}).`;
  cleanupDragUI();
  renderAndPersist();
}

function cancelCreateButtonDragIfStarted(message) {
  if (!createButtonPress) return;
  const wasDrag = createButtonPress.startedDrag;
  cancelCreateButtonPress();
  if (wasDrag) {
    cleanupDragUI(message, true);
  }
}

createBtn.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !e.isPrimary) return;
  if (!canCreateAnotherBox()) {
    setMaxBoxCountReachedStatus();
    return;
  }
  cancelCreateButtonPress();
  createButtonPress = {
    pointerId: e.pointerId,
    holdElapsed: false,
    startedDrag: false,
    startPoint: { x: e.clientX, y: e.clientY },
    lastPoint: { x: e.clientX, y: e.clientY },
    holdTimer: window.setTimeout(() => {
      if (!createButtonPress || createButtonPress.pointerId !== e.pointerId) return;
      createButtonPress.holdElapsed = true;
    }, CREATE_BUTTON_HOLD_MS)
  };
  createBtn.setPointerCapture(e.pointerId);
});

createBtn.addEventListener("pointermove", (e) => {
  if (!createButtonPress || createButtonPress.pointerId !== e.pointerId) return;
  updateCreateButtonPointer({ x: e.clientX, y: e.clientY });
});

createBtn.addEventListener("pointerup", (e) => {
  if (!createButtonPress || createButtonPress.pointerId !== e.pointerId) return;
  finishCreateButtonPointer({ x: e.clientX, y: e.clientY });
});

createBtn.addEventListener("pointercancel", (e) => {
  if (!createButtonPress || createButtonPress.pointerId !== e.pointerId) return;
  cancelCreateButtonDragIfStarted("Create canceled.");
});

createBtn.addEventListener("lostpointercapture", () => {
  cancelCreateButtonDragIfStarted("Create canceled.");
});

createBtn.addEventListener("click", () => {
  if (suppressNextCreateClick) {
    suppressNextCreateClick = false;
    return;
  }
  createBoxInActiveSegment();
});

resetBtn.addEventListener("click", () => {
  idCounter = 1;
  panelCounter = 1;
  root = createPanelNode(createBoxTab());
  activePanelId = root.id;
  previewMode = DEFAULT_PREVIEW_MODE;
  dragController.resetDragSession();
  clearPersistedLayoutState();
  updateViewModeButton();
  statusEl.textContent = "Layout reset to one panel with one box.";
  renderAndPersist();
});

viewModeBtn.addEventListener("click", () => {
  previewMode = previewMode === "hitbox" ? "preview" : "hitbox";
  updateViewModeButton();
  const dragCtx = getDragCtx();
  const lastDragPoint = getLastDragPoint();
  if (dragCtx && lastDragPoint) {
    dragController.stopPreviewIdleTimer();
    dragController.setHoverAnchorPoint(lastDragPoint);
    dragController.setDragVisualState("hitbox");
    clearDropPreviewLayer();
    updateHoverFromPoint(lastDragPoint.x, lastDragPoint.y);
    if (previewMode === "preview") {
      scheduleIdlePreview();
      statusEl.textContent = "Preview mode enabled. Keep moving to inspect hitboxes, pause briefly to see drop preview.";
    } else {
      statusEl.textContent = "Hitbox mode enabled. Showing raw hit zones while dragging.";
    }
  } else {
    statusEl.textContent = previewMode === "preview"
      ? "Preview mode enabled. While dragging: move for hitboxes, pause briefly for a live drop preview."
      : "Hitbox mode enabled. Drag tabs to inspect drop zones.";
  }
  persistLayoutState();
});

window.addEventListener("dragend", () => {
  if (!dragController.hasTransientState()) return;
  cleanupDragUI("Drag canceled/reset.", true);
});

window.addEventListener("dragover", (e) => {
  const dragCtx = getDragCtx();
  if (!dragCtx || !dragCtx.sourcePanelId) return;
  const point = { x: e.clientX, y: e.clientY };
  moveDragGhost(point);
  setLastDragPoint(point);
});

window.addEventListener("drop", () => {
  if (!dragController.hasTransientState()) return;
  cleanupDragUI(null, true);
});

workspaceEl.addEventListener("dragover", onWorkspaceDragOver);
workspaceEl.addEventListener("drop", onWorkspaceDrop);

updateViewModeButton();
renderAndPersist();
