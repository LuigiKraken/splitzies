import { cloneNode, findNodeById, removePanelAndCollapse } from "./layoutModel.js";
import { clamp } from "./geometry.js";

export function executeDrop(root, zone, tab, sourcePanelId, { createPanelNode, createContainer, createFallbackRoot, axisForDirection, isBeforeDirection }) {
  if (!zone || !tab || zone.type === "INVALID") return null;

  const nextRoot = cloneNode(root);
  let movingTab = { ...tab };
  let activePanelId = null;

  if (sourcePanelId) {
    const sourceFound = findNodeById(nextRoot, sourcePanelId);
    if (!sourceFound || sourceFound.node.type !== "panel") return null;
    const sourcePanel = sourceFound.node;
    const tabIdx = sourcePanel.tabs.findIndex((t) => t.id === tab.id);
    if (tabIdx === -1) return null;
    [movingTab] = sourcePanel.tabs.splice(tabIdx, 1);
    if (sourcePanel.activeTabId === movingTab.id) {
      sourcePanel.activeTabId = sourcePanel.tabs[0] ? sourcePanel.tabs[0].id : null;
    }
  }

  let resultRoot = nextRoot;

  if (zone.type === "STACK") {
    const targetFound = findNodeById(nextRoot, zone.panelId);
    if (!targetFound || targetFound.node.type !== "panel") return null;
    targetFound.node.tabs.push(movingTab);
    targetFound.node.activeTabId = movingTab.id;
    activePanelId = targetFound.node.id;

  } else if (zone.type === "SPLIT") {
    const targetFound = findNodeById(nextRoot, zone.panelId);
    if (!targetFound || targetFound.node.type !== "panel") return null;
    const newPanel = createPanelNode(movingTab);
    const axis = axisForDirection(zone.direction);
    const children = isBeforeDirection(zone.direction)
      ? [newPanel, targetFound.node]
      : [targetFound.node, newPanel];
    const split = createContainer(axis, children);
    if (!targetFound.parent) {
      resultRoot = split;
    } else {
      targetFound.parent.children[targetFound.indexInParent] = split;
    }
    activePanelId = newPanel.id;

  } else if (zone.type === "EQUALIZE") {
    const ancestorFound = findNodeById(nextRoot, zone.targetId);
    if (!ancestorFound || ancestorFound.node.type !== "container") return null;
    const newPanel = createPanelNode(movingTab);
    const insertAt = clamp(zone.insertIndex, 0, ancestorFound.node.children.length);
    ancestorFound.node.children.splice(insertAt, 0, newPanel);
    const n = ancestorFound.node.children.length;
    ancestorFound.node.sizes = ancestorFound.node.children.map(() => 1 / n);
    activePanelId = newPanel.id;

  } else if (zone.type === "WRAP") {
    const ancestorFound = findNodeById(nextRoot, zone.targetId);
    if (!ancestorFound) return null;
    const newPanel = createPanelNode(movingTab);
    const axis = axisForDirection(zone.direction);
    const children = isBeforeDirection(zone.direction)
      ? [newPanel, ancestorFound.node]
      : [ancestorFound.node, newPanel];
    const wrapper = createContainer(axis, children);
    if (!ancestorFound.parent) {
      resultRoot = wrapper;
    } else {
      ancestorFound.parent.children[ancestorFound.indexInParent] = wrapper;
    }
    activePanelId = newPanel.id;
  }

  if (sourcePanelId) {
    const finalSourceCheck = findNodeById(resultRoot, sourcePanelId);
    if (finalSourceCheck && finalSourceCheck.node.type === "panel" && finalSourceCheck.node.tabs.length === 0) {
      resultRoot = removePanelAndCollapse(resultRoot, sourcePanelId, createFallbackRoot);
    }
  }

  return { root: resultRoot, activePanelId };
}
