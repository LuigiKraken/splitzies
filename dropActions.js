(function attachDropActions(global) {
  "use strict";

  function create(deps) {
    const {
      getRoot,
      setRoot,
      setActivePanelId,
      cloneNode,
      findNodeById,
      removePanelAndCollapse,
      canCreateAnotherBox,
      createBoxTab,
      createPanelNode,
      createContainer,
      createFallbackRoot,
      axisForDirection,
      isBeforeDirection,
      clamp
    } = deps;

    function executeDrop(zone, tab, sourcePanelId = null) {
      if (!zone || !tab) return;
      if (zone.type === "INVALID") return;

      const nextRoot = cloneNode(getRoot());
      let movingTab = { ...tab };
      let consumeSourceTab = !!sourcePanelId;

      if (!consumeSourceTab && !canCreateAnotherBox()) return;

      if (consumeSourceTab) {
        const sourceFound = findNodeById(nextRoot, sourcePanelId);
        if (!sourceFound || sourceFound.node.type !== "panel") return;

        const sourcePanel = sourceFound.node;
        const tabIdx = sourcePanel.tabs.findIndex((t) => t.id === tab.id);
        if (tabIdx === -1) return;
        [movingTab] = sourcePanel.tabs.splice(tabIdx, 1);
        if (sourcePanel.activeTabId === movingTab.id) {
          sourcePanel.activeTabId = sourcePanel.tabs[0] ? sourcePanel.tabs[0].id : null;
        }
      }

      if (zone.type === "STACK") {
        const targetFound = findNodeById(nextRoot, zone.panelId);
        if (!targetFound || targetFound.node.type !== "panel") return;
        targetFound.node.tabs.push(movingTab);
        targetFound.node.activeTabId = movingTab.id;
        setRoot(nextRoot);
        setActivePanelId(targetFound.node.id);
      } else if (zone.type === "SPLIT") {
        const targetFound = findNodeById(nextRoot, zone.panelId);
        if (!targetFound || targetFound.node.type !== "panel") return;
        const newPanel = createPanelNode(movingTab);
        const axis = axisForDirection(zone.direction);
        const children = isBeforeDirection(zone.direction)
          ? [newPanel, targetFound.node]
          : [targetFound.node, newPanel];
        const split = createContainer(axis, children);

        if (!targetFound.parent) {
          setRoot(split);
        } else {
          targetFound.parent.children[targetFound.indexInParent] = split;
          setRoot(nextRoot);
        }
        setActivePanelId(newPanel.id);
      } else if (zone.type === "EQUALIZE") {
        const ancestorFound = findNodeById(nextRoot, zone.targetId);
        if (!ancestorFound || ancestorFound.node.type !== "container") return;
        const newPanel = createPanelNode(movingTab);
        const insertAt = clamp(zone.insertIndex, 0, ancestorFound.node.children.length);
        ancestorFound.node.children.splice(insertAt, 0, newPanel);
        const n = ancestorFound.node.children.length;
        ancestorFound.node.sizes = ancestorFound.node.children.map(() => 1 / n);
        setRoot(nextRoot);
        setActivePanelId(newPanel.id);
      } else if (zone.type === "WRAP") {
        const ancestorFound = findNodeById(nextRoot, zone.targetId);
        if (!ancestorFound) return;
        const newPanel = createPanelNode(movingTab);
        const axis = axisForDirection(zone.direction);
        const children = isBeforeDirection(zone.direction)
          ? [newPanel, ancestorFound.node]
          : [ancestorFound.node, newPanel];
        const wrapper = createContainer(axis, children);

        if (!ancestorFound.parent) {
          setRoot(wrapper);
        } else {
          ancestorFound.parent.children[ancestorFound.indexInParent] = wrapper;
          setRoot(nextRoot);
        }
        setActivePanelId(newPanel.id);
      }

      if (consumeSourceTab) {
        const finalRoot = getRoot();
        const finalSourceCheck = findNodeById(finalRoot, sourcePanelId);
        if (finalSourceCheck && finalSourceCheck.node.type === "panel" && finalSourceCheck.node.tabs.length === 0) {
          setRoot(removePanelAndCollapse(finalRoot, sourcePanelId, createFallbackRoot));
        }
      }
    }

    return {
      executeDrop
    };
  }

  global.DropActions = {
    create
  };
})(window);
