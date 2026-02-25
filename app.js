const CONFIG = window.DOCK_CONFIG;
if (!CONFIG || typeof CONFIG !== "object") {
  throw new Error("Missing DOCK_CONFIG. Ensure config.js is loaded before app.js.");
}
const VIEW_MODES = ["hitbox", "preview", "combined"];

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
const DEFAULT_PREVIEW_MODE = CONFIG.defaultPreviewMode;
let previewMode = DEFAULT_PREVIEW_MODE;

const CREATE_BUTTON_HOLD_MS = 160;
const CREATE_BUTTON_DRAG_START_PX = 6;

const workspaceEl = document.getElementById("workspace");
const statusEl = document.getElementById("status");
const treeViewEl = document.getElementById("treeView");
const createBtn = document.getElementById("createBtn");
const resetBtn = document.getElementById("resetBtn");
const viewModeBtn = document.getElementById("viewModeBtn");
const darkModeBtn = document.getElementById("darkModeBtn");
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
let resizeFrameHandle = null;
let resizeController = null;

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

const formatZoneSummary = (zone, includeTarget = false) => {
  if (!zone) return "";
  const direction = zone.direction ? ` dir=${zone.direction}` : "";
  const target = includeTarget && zone.targetId ? ` target=${zone.targetId}` : "";
  return `${zone.type} | layer=${zone.layer}${direction}${target}`;
};

const setMaxBoxCountReachedStatus = () => {
  statusEl.textContent = `Cannot create more boxes: max total box count is ${CONFIG.maxTotalBoxCount}.`;
};

function applyRuntimeStyleConfig() {
  const rootStyle = document.documentElement.style;
  const workspaceBounds = workspaceEl.getBoundingClientRect();
  const workspaceWidth = workspaceBounds.width || window.innerWidth || 1;
  const workspaceHeight = workspaceBounds.height || window.innerHeight || 1;
  const minBoxWidthPx = Math.max(1, Math.round(workspaceWidth * CONFIG.minBoxWidthFraction));
  const minBoxHeightPx = Math.max(1, Math.round(workspaceHeight * CONFIG.minBoxHeightFraction));
  rootStyle.setProperty("--min-box-width-px", `${minBoxWidthPx}px`);
  rootStyle.setProperty("--min-box-height-px", `${minBoxHeightPx}px`);
}

applyRuntimeStyleConfig();

const DARK_MODE_STORAGE_KEY = "dock-dark-mode";
let isDarkMode = false;

function applyDarkMode(dark) {
  isDarkMode = dark;
  document.documentElement.dataset.theme = dark ? "dark" : "";
  darkModeBtn.textContent = dark ? "Light Mode" : "Dark Mode";
  try { localStorage.setItem(DARK_MODE_STORAGE_KEY, dark ? "1" : "0"); } catch (err) {}
}

(function initDarkMode() {
  let stored = false;
  try { stored = localStorage.getItem(DARK_MODE_STORAGE_KEY) === "1"; } catch (err) {}
  applyDarkMode(stored);
}());

darkModeBtn.addEventListener("click", () => {
  applyDarkMode(!isDarkMode);
});

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

function makeNodeFactories(idSeed, panelSeed) {
  let localIdCount = idSeed;
  let localPanelCount = panelSeed;
  const localNextId = (prefix) => `${prefix}-${localIdCount++}`;
  return {
    createBoxTab: () => ({ id: localNextId("tab"), num: localPanelCount++ }),
    createPanelNode: (tab) => ({ type: "panel", id: localNextId("panel"), tabs: [tab], activeTabId: tab.id }),
    createContainer: (axis, children) => {
      const size = 1 / children.length;
      return { type: "container", id: localNextId("container"), axis, sizes: children.map(() => size), children };
    }
  };
}

const axisStackLimit = (axis) =>
  axis === "column" ? CONFIG.maxHorizontalStack : CONFIG.maxVerticalStack;

const canAddSiblingToAxis = (axis, nextSiblingCount) =>
  nextSiblingCount <= axisStackLimit(axis);

const canCreateAnotherBox = () =>
  getTotalBoxCount(root) < CONFIG.maxTotalBoxCount;

const persistenceApi = window.Persistence;
if (!persistenceApi) {
  throw new Error("Missing Persistence. Ensure persistence.js is loaded before app.js.");
}
const persistence = persistenceApi.create({
  persistLayout: CONFIG.persistLayout,
  defaultPreviewMode: DEFAULT_PREVIEW_MODE,
  findNodeById,
  getFirstPanel
});

function persistLayoutState() {
  persistence.persistLayoutState({ root, activePanelId, previewMode, idCounter, panelCounter });
}

const clearPersistedLayoutState = () => persistence.clearPersistedLayoutState();

(function restoreIfAvailable() {
  const restored = persistence.restorePersistedLayoutState();
  if (!restored) return;
  root = restored.root;
  activePanelId = restored.activePanelId;
  previewMode = restored.previewMode;
  idCounter = restored.idCounter;
  panelCounter = restored.panelCounter;
}());

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
const { executeDrop } = dropActionsApi.create({
  getRoot: () => root,
  setRoot: (nextRoot) => { root = nextRoot; },
  setActivePanelId: (panelId) => { activePanelId = panelId; },
  cloneNode,
  findNodeById,
  removePanelAndCollapse,
  canCreateAnotherBox,
  createBoxTab,
  createPanelNode,
  createContainer,
  createFallbackRoot: () => createPanelNode(createBoxTab()),
  axisForDirection,
  isBeforeDirection,
  clamp: (v, min, max) => Math.max(min, Math.min(max, v))
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
    onPanelDrop,
    onResizeHandlePointerDown: (e, panelId, corner) => resizeController.onResizeHandlePointerDown(e, panelId, corner)
  }
});

const animationsApi = window.Animations;
if (!animationsApi) {
  throw new Error("Missing Animations. Ensure animations.js is loaded before app.js.");
}
const { animateDropTransition, animatePreviewTransition } = animationsApi.create({
  workspaceEl,
  dropTransitionMs: CONFIG.dropTransitionMs,
  previewTransitionMs: CONFIG.previewTransitionMs
});

function renderAndPersist() {
  render();
  syncOverlayForCurrentMode();
  persistLayoutState();
}

function renderWithoutPersist() {
  render();
  syncOverlayForCurrentMode();
}

function renderAndPersistWithDropTransition(previousRects, enteredPanelId = null) {
  renderAndPersist();
  animateDropTransition(previousRects, enteredPanelId);
}

function capturePanelRects() {
  const rectMap = new Map();
  for (const panelEl of workspaceEl.querySelectorAll(".panel[data-panel-id]")) {
    const panelId = panelEl.dataset.panelId;
    if (!panelId) continue;
    const r = panelEl.getBoundingClientRect();
    rectMap.set(panelId, { left: r.left, top: r.top, width: r.width, height: r.height });
  }
  return rectMap;
}

const resizeControllerApi = window.ResizeController;
if (!resizeControllerApi) {
  throw new Error("Missing ResizeController. Ensure resizeController.js is loaded before app.js.");
}
resizeController = resizeControllerApi.create({
  config: CONFIG,
  workspaceEl,
  statusEl,
  getRoot: () => root,
  setRoot: (nextRoot) => { root = nextRoot; },
  setActivePanelId: (panelId) => { activePanelId = panelId; },
  cloneNode,
  buildPanelInfoMap,
  findNodeById,
  axisForDirection,
  isBeforeDirection,
  getDragCtx,
  renderWithoutPersist,
  renderAndPersist
});

function syncOverlayForCurrentMode() {
  if (getDragCtx()) return;
  if (previewMode === "hitbox") {
    drawZonesForWorkspace(buildPanelInfoMap(root), null, null, { dimUnselected: false });
  } else {
    clearDragOverlay();
  }
}

const removeDragGhost = () => {
  if (dragGhostEl) { dragGhostEl.remove(); dragGhostEl = null; }
};

function ensureDragGhost(label) {
  removeDragGhost();
  const ghost = document.createElement("div");
  ghost.className = "create-drag-ghost";
  ghost.textContent = label;
  document.body.appendChild(ghost);
  dragGhostEl = ghost;
}

const moveDragGhost = (point) => {
  if (dragGhostEl) dragGhostEl.style.transform = `translate(${point.x + 14}px, ${point.y + 14}px)`;
};

function getTransparentDragImage() {
  if (!transparentDragImageEl) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    transparentDragImageEl = canvas;
  }
  return transparentDragImageEl;
}

function buildDropPreviewTree(zone) {
  const dragCtx = getDragCtx();
  if (!dragCtx || !zone) return null;

  const previewState = {
    root: cloneNode(root),
    activePanelId
  };
  const {
    createBoxTab: createPreviewBoxTab,
    createPanelNode: createPreviewPanelNode,
    createContainer: createPreviewContainer
  } = makeNodeFactories(idCounter, panelCounter);

  const { executeDrop: executePreviewDrop } = dropActionsApi.create({
    getRoot: () => previewState.root,
    setRoot: (nextRoot) => { previewState.root = nextRoot; },
    setActivePanelId: (panelId) => { previewState.activePanelId = panelId; },
    cloneNode,
    findNodeById,
    removePanelAndCollapse,
    canCreateAnotherBox: () => getTotalBoxCount(previewState.root) < CONFIG.maxTotalBoxCount,
    createBoxTab: createPreviewBoxTab,
    createPanelNode: createPreviewPanelNode,
    createContainer: createPreviewContainer,
    createFallbackRoot: () => createPreviewPanelNode(createPreviewBoxTab()),
    axisForDirection,
    isBeforeDirection,
    clamp: (v, min, max) => Math.max(min, Math.min(max, v))
  });

  executePreviewDrop(zone, dragCtx.tab, dragCtx.sourcePanelId);
  return cloneNode(previewState.root);
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
  previewLayer.innerHTML = "";
  previewLayer.appendChild(treeDom);
  previewLayer.classList.toggle("combined-tone", previewMode === "combined");
  previewLayer.classList.add("active");
  workspaceEl.classList.add("previewing");
  animatePreviewTransition(previewLayer, sourceRects);
}

function scheduleIdlePreview() {
  dragController.schedulePreviewIdle(() => {
    const dragCtx = getDragCtx();
    const lastDragPoint = getLastDragPoint();
    if (!dragCtx || (previewMode !== "preview" && previewMode !== "combined") || !lastDragPoint) return;
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

function showPreviewSearchStateAtPoint(x, y) {
  clearDropPreviewLayer();
  dragController.setHoverPreview(null);
  clearDragOverlay();
  const hover = resolveHoverAtPoint(buildPanelInfoMap(root), x, y);
  if (!hover) {
    statusEl.textContent = "Move over a panel and pause briefly to see the drop preview.";
  } else if (!hover.zone) {
    statusEl.textContent = "No valid drop zone here. Move and pause in another spot.";
  } else if (hover.zone.type === "INVALID") {
    statusEl.textContent = `Preview blocked: ${hover.zone.reason}`;
  } else {
    statusEl.textContent = "Pause briefly to show drop preview.";
  }
}

function handlePreviewModeDragOver(x, y) {
  dragController.handlePreviewModeDragOver(x, y, () => {
    showPreviewSearchStateAtPoint(x, y);
    scheduleIdlePreview();
  });
}

function handleCombinedModeDragOver(x, y) {
  dragController.handlePreviewModeDragOver(x, y, () => {
    clearDropPreviewLayer();
    dragController.setHoverPreview(null);
    updateHoverFromPoint(x, y);
    statusEl.textContent = "Combined mode: hitboxes visible while moving. Pause briefly for a softer preview replacement.";
    scheduleIdlePreview();
  });
}

// Shared drag-over mode dispatch used by panel, workspace, and create-button handlers.
function dispatchDragOver(x, y) {
  if (previewMode === "hitbox") {
    updateHoverFromPoint(x, y);
  } else if (previewMode === "combined") {
    handleCombinedModeDragOver(x, y);
  } else {
    handlePreviewModeDragOver(x, y);
  }
}

// Shared drop execution used by onPanelDrop and onWorkspaceDrop.
function commitDrop(zone, dragCtx) {
  const previousRects = capturePanelRects();
  executeDrop(zone, dragCtx.tab, dragCtx.sourcePanelId);
  const enteredPanelId = previousRects.has(activePanelId) ? null : activePanelId;
  statusEl.textContent = `Dropped Box ${dragCtx.tab.num}: ${zone.type} (layer ${zone.layer}${zone.direction ? ` ${zone.direction}` : ""}).`;
  cleanupDragUI();
  renderAndPersistWithDropTransition(previousRects, enteredPanelId);
}

function updateViewModeButton() {
  const labels = {
    hitbox:   ["Mode: Hitbox",    "Switch to preview mode"],
    preview:  ["Mode: Preview",   "Switch to combined mode"],
    combined: ["Mode: Combined",  "Switch to hitbox mode"]
  };
  const [text, ariaLabel] = labels[previewMode] || labels.hitbox;
  viewModeBtn.textContent = text;
  viewModeBtn.setAttribute("aria-label", ariaLabel);
}

const syncResizeAffordanceMode = () => {
  workspaceEl.dataset.resizeAffordance = previewMode === "hitbox" ? "circles" : "cursor-only";
};

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
    if (previewMode === "hitbox") {
      drawZonesForWorkspace(panelInfoMap, null, null, { dimUnselected: false });
      statusEl.textContent = "Hitbox mode: all drop zones remain visible while dragging.";
    } else {
      clearDragOverlay();
      statusEl.textContent = "Move over a panel to preview drop zones.";
    }
    return;
  }

  dragController.setHoverPreview({
    panelId: hover.panelId || null,
    depth: hover.info ? hover.info.depth : null,
    zone: hover.zone
  });
  drawZonesForWorkspace(panelInfoMap, hover.zone, hover.panelId, {
    dimUnselected: previewMode !== "hitbox"
  });

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

function syncDragVisualsForResize() {
  const dragCtx = getDragCtx();
  const lastDragPoint = getLastDragPoint();
  if (!dragCtx || !lastDragPoint) {
    syncOverlayForCurrentMode();
    return;
  }

  dragController.stopPreviewIdleTimer();
  clearDropPreviewLayer();
  dragController.setHoverPreview(null);

  if (previewMode === "hitbox") {
    updateHoverFromPoint(lastDragPoint.x, lastDragPoint.y);
  } else if (previewMode === "combined") {
    updateHoverFromPoint(lastDragPoint.x, lastDragPoint.y);
    scheduleIdlePreview();
  } else {
    showPreviewSearchStateAtPoint(lastDragPoint.x, lastDragPoint.y);
    scheduleIdlePreview();
  }
}

function onWindowResize() {
  if (resizeFrameHandle) return;
  resizeFrameHandle = window.requestAnimationFrame(() => {
    resizeFrameHandle = null;
    applyRuntimeStyleConfig();
    syncDragVisualsForResize();
  });
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
  dragController.setHoverAnchorPoint(null);
  dragController.stopPreviewIdleTimer();
  dragController.stopDragPreviewTimer();
  if (previewMode === "preview") {
    showPreviewSearchStateAtPoint(point.x, point.y);
  } else {
    updateHoverFromPoint(point.x, point.y);
  }
  if (previewMode === "preview" || previewMode === "combined") {
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
    if (previewMode !== "preview" && previewMode !== "combined") {
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
  const previousRects = capturePanelRects();

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
  renderAndPersistWithDropTransition(previousRects);
}

function onPanelDragOver(e) {
  if (!getDragCtx()) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  setLastDragPoint({ x: e.clientX, y: e.clientY });
  dispatchDragOver(e.clientX, e.clientY);
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
  const hover = resolveHoverAtPoint(buildPanelInfoMap(root), e.clientX, e.clientY);
  const zone = (hoverPreview && hoverPreview.zone) || (hover && hover.zone) || null;
  if (!zone) { statusEl.textContent = "Drop canceled: no valid zone here."; return; }
  if (zone.type === "INVALID") { statusEl.textContent = `Drop blocked: ${zone.reason}`; return; }
  if (!dragCtx.sourcePanelId && !canCreateAnotherBox()) {
    statusEl.textContent = `Drop blocked: max total box count (${CONFIG.maxTotalBoxCount}) reached.`;
    return;
  }
  commitDrop(zone, dragCtx);
}

function onWorkspaceDragOver(e) {
  const dragCtx = getDragCtx();
  if (!dragCtx || !dragCtx.sourcePanelId) return;
  if (e.target.closest(".panel[data-panel-id]")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  setLastDragPoint({ x: e.clientX, y: e.clientY });
  dispatchDragOver(e.clientX, e.clientY);
}

function onWorkspaceDrop(e) {
  const dragCtx = resolveDragCtxFromDropEvent(e);
  if (!dragCtx || !dragCtx.sourcePanelId) return;
  if (e.target.closest(".panel[data-panel-id]")) return;
  e.preventDefault();

  const hoverPreview = getHoverPreview();
  const hover = resolveHoverAtPoint(buildPanelInfoMap(root), e.clientX, e.clientY);
  const zone = (hoverPreview && hoverPreview.zone) || (hover && hover.zone) || null;
  if (!zone) { statusEl.textContent = "Drop canceled: no valid zone here."; return; }
  if (zone.type === "INVALID") { statusEl.textContent = `Drop blocked: ${zone.reason}`; return; }
  commitDrop(zone, dragCtx);
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
  dispatchDragOver(point.x, point.y);
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

  const previousRects = capturePanelRects();
  executeDrop(hover.zone, dragCtx.tab, dragCtx.sourcePanelId);
  const enteredPanelId = previousRects.has(activePanelId) ? null : activePanelId;
  statusEl.textContent = `Created Box ${dragCtx.tab.num}: ${hover.zone.type} (layer ${hover.zone.layer}${hover.zone.direction ? ` ${hover.zone.direction}` : ""}).`;
  cleanupDragUI();
  renderAndPersistWithDropTransition(previousRects, enteredPanelId);
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
  if (resizeController) {
    resizeController.cancelActiveResize();
  }
  idCounter = 1;
  panelCounter = 1;
  root = createPanelNode(createBoxTab());
  activePanelId = root.id;
  previewMode = DEFAULT_PREVIEW_MODE;
  dragController.resetDragSession();
  clearPersistedLayoutState();
  updateViewModeButton();
  syncResizeAffordanceMode();
  statusEl.textContent = "Layout reset to one panel with one box.";
  renderAndPersist();
});

viewModeBtn.addEventListener("click", () => {
  const modeIndex = VIEW_MODES.indexOf(previewMode);
  const safeIndex = modeIndex === -1 ? 0 : modeIndex;
  previewMode = VIEW_MODES[(safeIndex + 1) % VIEW_MODES.length];
  updateViewModeButton();
  syncResizeAffordanceMode();

  const modeMessages = {
    hitbox:   { dragging: "Hitbox mode enabled. Showing raw hit zones while dragging.",                                                             idle: "Hitbox mode enabled. Drag tabs to inspect drop zones." },
    preview:  { dragging: "Preview mode enabled. Hitboxes stay hidden while moving; pause briefly to see the drop preview.",                        idle: "Preview mode enabled. While dragging: move without hitboxes, then pause briefly for a live drop preview." },
    combined: { dragging: "Combined mode enabled. Hitboxes show while moving; pause to see a softer preview replacement.",                          idle: "Combined mode enabled. While dragging: hitboxes stay visible while moving, then a softer preview replaces them on pause." }
  };

  const dragCtx = getDragCtx();
  const lastDragPoint = getLastDragPoint();
  if (dragCtx && lastDragPoint) {
    dragController.stopPreviewIdleTimer();
    dragController.setHoverAnchorPoint(lastDragPoint);
    clearDropPreviewLayer();
    if (previewMode === "preview") {
      showPreviewSearchStateAtPoint(lastDragPoint.x, lastDragPoint.y);
    } else {
      updateHoverFromPoint(lastDragPoint.x, lastDragPoint.y);
    }
    if (previewMode === "preview" || previewMode === "combined") scheduleIdlePreview();
    statusEl.textContent = (modeMessages[previewMode] || modeMessages.hitbox).dragging;
  } else {
    statusEl.textContent = (modeMessages[previewMode] || modeMessages.hitbox).idle;
  }
  syncOverlayForCurrentMode();
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
window.addEventListener("pointermove", (e) => resizeController.onResizePointerMove(e));
window.addEventListener("pointerup", (e) => resizeController.onResizePointerUp(e));
window.addEventListener("pointercancel", (e) => resizeController.onResizePointerCancel(e));
window.addEventListener("resize", onWindowResize);

workspaceEl.addEventListener("dragover", onWorkspaceDragOver);
workspaceEl.addEventListener("drop", onWorkspaceDrop);
workspaceEl.addEventListener("pointerdown", (e) => resizeController.onWorkspacePointerDown(e));

updateViewModeButton();
syncResizeAffordanceMode();
renderAndPersist();
