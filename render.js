(function attachDockRenderer(global) {
  "use strict";

  function create(deps) {
    const {
      workspaceEl,
      treeViewEl,
      panelTreeString,
      buildPanelInfoMap,
      findNodeById,
      getRoot,
      getActivePanelId,
      setActivePanelId,
      handlers
    } = deps;

    function createWorkspacePreviewLayer() {
      const el = document.createElement("div");
      el.className = "workspace-preview";
      el.id = "workspacePreview";
      return el;
    }

    function createWorkspaceOverlayLayer() {
      const el = document.createElement("div");
      el.className = "workspace-overlay";
      el.id = "workspaceOverlay";
      return el;
    }

    function renderPanel(panel, info, interactive) {
      const panelEl = document.createElement("div");
      panelEl.className = "node panel";
      panelEl.dataset.panelId = panel.id;
      panelEl.dataset.nodeId = panel.id;
      if (panel.id === getActivePanelId()) {
        panelEl.classList.add("active-panel");
      }

      const tabsEl = document.createElement("div");
      tabsEl.className = "tabs";

      panel.tabs.forEach((tab) => {
        const tabEl = document.createElement("div");
        tabEl.className = "tab";
        tabEl.draggable = interactive;
        const labelEl = document.createElement("span");
        labelEl.className = "tab-label";
        labelEl.textContent = `Box ${tab.num}`;
        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "tab-close";
        closeBtn.textContent = "x";
        closeBtn.title = `Remove Box ${tab.num}`;
        closeBtn.setAttribute("aria-label", `Remove Box ${tab.num}`);
        if (interactive) {
          closeBtn.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            e.preventDefault();
          });
          closeBtn.addEventListener("click", (e) => handlers.onCloseTabClick(e, panel.id, tab.id));
          tabEl.addEventListener("click", (e) => handlers.onTabClick(e, panel.id, tab.id));
        } else {
          closeBtn.disabled = true;
        }
        tabEl.dataset.tabId = tab.id;
        tabEl.dataset.panelId = panel.id;
        if (interactive) {
          tabEl.addEventListener("dragstart", handlers.onTabDragStart);
          tabEl.addEventListener("dragend", handlers.onTabDragEnd);
        }
        tabEl.appendChild(labelEl);
        tabEl.appendChild(closeBtn);
        tabsEl.appendChild(tabEl);
      });

      const bodyEl = document.createElement("div");
      bodyEl.className = "panel-body";
      const active = panel.tabs.find((t) => t.id === panel.activeTabId) || panel.tabs[0];
      if (active) {
        const numberEl = document.createElement("div");
        numberEl.className = "panel-number";
        numberEl.textContent = String(active.num);
        bodyEl.appendChild(numberEl);
      }

      const metaEl = document.createElement("div");
      metaEl.className = "panel-meta";
      metaEl.innerHTML = `<span>depth: ${info ? info.depth : 0}</span><span>tabs: ${panel.tabs.length}</span>`;

      panelEl.appendChild(tabsEl);
      panelEl.appendChild(bodyEl);
      panelEl.appendChild(metaEl);

      if (interactive) {
        panelEl.addEventListener("click", (e) => handlers.onPanelClick(e, panel.id));
        panelEl.addEventListener("dragover", handlers.onPanelDragOver);
        panelEl.addEventListener("drop", handlers.onPanelDrop);
      }
      return panelEl;
    }

    function renderNode(node, panelInfoMap, interactive) {
      if (node.type === "panel") {
        return renderPanel(node, panelInfoMap.get(node.id), interactive);
      }

      const container = document.createElement("div");
      container.className = `node container ${node.axis}`;
      container.dataset.nodeId = node.id;

      node.children.forEach((child, i) => {
        const childWrap = document.createElement("div");
        childWrap.className = "child";
        childWrap.style.flexGrow = node.sizes[i];
        childWrap.style.flexBasis = "0";
        childWrap.style.minWidth = "0";
        childWrap.style.minHeight = "0";
        childWrap.appendChild(renderNode(child, panelInfoMap, interactive));
        container.appendChild(childWrap);
      });
      return container;
    }

    function renderTree(rootNode, interactive) {
      const panelInfoMap = buildPanelInfoMap(rootNode);
      return renderNode(rootNode, panelInfoMap, interactive);
    }

    function renderPreviewTree(previewTree) {
      return renderTree(previewTree, false);
    }

    function clearDropPreviewLayer() {
      const preview = document.getElementById("workspacePreview");
      if (!preview) return;
      preview.classList.remove("active");
      preview.innerHTML = "";
      workspaceEl.classList.remove("previewing");
    }

    function clearDragOverlay() {
      const overlay = document.getElementById("workspaceOverlay");
      if (overlay) overlay.innerHTML = "";
      clearDropPreviewLayer();
      workspaceEl.querySelectorAll(".panel.drag-hover").forEach((p) => p.classList.remove("drag-hover"));
    }

    function render() {
      const root = getRoot();
      const activePanelId = getActivePanelId();
      if (activePanelId) {
        const activeFound = findNodeById(root, activePanelId);
        if (!activeFound || activeFound.node.type !== "panel") {
          setActivePanelId(null);
        }
      }

      workspaceEl.innerHTML = "";
      const treeDom = renderTree(root, true);
      treeDom.classList.add("workspace-tree");
      workspaceEl.appendChild(treeDom);
      workspaceEl.appendChild(createWorkspacePreviewLayer());
      workspaceEl.appendChild(createWorkspaceOverlayLayer());

      treeViewEl.textContent = panelTreeString(root);
    }

    return {
      render,
      renderPreviewTree,
      clearDropPreviewLayer,
      clearDragOverlay
    };
  }

  global.DockRenderer = {
    create
  };
})(window);
