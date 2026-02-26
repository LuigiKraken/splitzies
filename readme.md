# Splitsy

**An interactive tech demo showing how any rectangle can be recursively segmented into further rectangles — and a portable blueprint for implementing this layout management pattern in any programming language.**

Use the interface to get a feel for how it works. Read the code to see how it's implemented. Port the algorithm to your own stack.

**[Live Demo](#)** — *deploy to GitHub Pages and update this link*

<!-- Add a screenshot or animated GIF here showing the demo in action -->

---

## What Is This?

A workspace starts as a single rectangle. That rectangle can be split into two halves. Each half can be split again. New rectangles can be inserted alongside existing ones. Any group can be wrapped in a perpendicular split. The result is an arbitrarily deep tree of nested rows and columns — a layout.

This project provides both the **portable algorithm** (in [`core/`](./core/)) and a **browser-based demo** that lets you interact with it through drag-and-drop.

At its core, dropping a tab does one of four things:

| Action       | What it does                                   |
|--------------|------------------------------------------------|
| **STACK**    | Add a tab to an existing panel (no layout change) |
| **SPLIT**    | Cut a single panel in half (50/50)              |
| **EQUALIZE** | Insert a new sibling into a row/column; all children reset to equal size |
| **WRAP**     | Nest an existing container in a new perpendicular split |

The demo offers three interaction modes: **Hitbox** (shows all drop zones while dragging — best for understanding the zone system), **Preview** (zones hidden while moving, live preview appears on pause), and **Combined** (both). Hitbox is the default.

---

## Quick Start

Vanilla JavaScript. No dependencies. No build step.

```bash
# Python
python -m http.server 8000

# or Node.js
npx http-server -p 8080

# Then open http://localhost:8000 (or :8080)
```

ES modules require an HTTP server (`file://` won't work). Any server works.

**Deploying:** Since this is static HTML/CSS/JS, you can deploy anywhere — GitHub Pages, Netlify, Vercel, or any static host. A GitHub Actions workflow is included at [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml).

---

## Project Structure

```
splitsy/
├── core/                    ← Portable algorithm (framework-independent)
│   ├── layoutModel.js       Tree data structure and operations
│   ├── geometry.js          Zone shape math (polygons, clipping, hit testing)
│   └── dropActions.js       Drop execution (STACK, SPLIT, EQUALIZE, WRAP)
│
├── index.html               Entry point
├── config.js                Configuration constants
├── app.js                   Application orchestrator and event handling
├── dropZones.js             Zone generation, constraint validation, overlay rendering
├── render.js                DOM rendering (tree → HTML)
├── dragController.js        Drag session state management
├── resizeController.js      Panel resize logic
├── animations.js            FLIP-style layout transitions
├── persistence.js           localStorage save/restore
└── styles.css               Stylesheet
```

**`core/`** contains the algorithm you'd port to another language. Everything else is the browser demo that visualizes it.

---

## Porting to Another Language

The algorithm needs four things:

1. **A tree data structure** ([`core/layoutModel.js`](./core/layoutModel.js))
   Leaf nodes are panels. Internal nodes are row/column containers with size ratios among their children. Operations: clone, find by ID, remove-and-collapse.

2. **Zone geometry** ([`core/geometry.js`](./core/geometry.js))
   Given a rectangle's bounds and its depth in the tree, compute concentric directional zones — triangular sectors subdivided into equal-width bands. Pure math, no framework dependency.

3. **Drop execution** ([`core/dropActions.js`](./core/dropActions.js))
   Given a zone descriptor, apply one of four operations to the tree: STACK, SPLIT, EQUALIZE, or WRAP. Returns a new tree (immutable updates via cloning).

4. **A renderer** (your framework's layout system)
   Walk the tree and position rectangles. Containers use flex-like proportional sizing — each child has a size ratio relative to its siblings.

Everything outside `core/` — drag handling, animations, persistence, overlay rendering — is browser-specific demo chrome. The zone *resolution* logic (determining which action fires based on the ancestor chain and cursor position) is documented in the [Algorithm Reference](#algorithm-reference) below and implemented in [`dropZones.js`](./dropZones.js).

---

## Configuration

All tunable parameters live in [`config.js`](./config.js). Override any default at runtime by setting `window.SPLITSY_CONFIG` before the app script loads:

```html
<script>
  window.SPLITSY_CONFIG = { centerFraction: 0.25, maxDepth: 4 };
</script>
<script type="module" src="./app.js"></script>
```

Key parameters:

| Parameter              | Default | Description |
|------------------------|---------|-------------|
| `centerFraction`       | 0.32    | Size of the center STACK zone relative to the panel |
| `maxDepth`             | 6       | Max ancestor levels exposed as directional layers |
| `minBoxWidthFraction`  | 0.08    | Minimum panel width as fraction of workspace |
| `minBoxHeightFraction` | 0.08    | Minimum panel height as fraction of workspace |
| `resizeSnapLevels`     | 8       | Number of discrete resize snap positions |
| `maxTotalBoxCount`     | 30      | Global cap on total panels/tabs |

---

## Algorithm Reference

### 1. Layout Model

The workspace is a **tree**:

- **Leaf node (Panel)** — a tab group with one or more tabs.
- **Internal node (Split Container)** — divides space among 2+ children, either as `column` (left→right) or `row` (top→bottom).
- Each child has a **size ratio** relative to its siblings.

**Notation:**

```
panel        → leaf node
column[A, B] → A and B side by side
row[A, B]    → A above B
```

Nesting is natural: `row[A, column[B, C]]` = A on top, B and C side by side below.

**Axis alignment:**

| Container | Children flow | Drop dirs along axis | Drop dirs perpendicular |
|-----------|--------------|----------------------|------------------------|
| `column`  | left → right | LEFT, RIGHT          | TOP, BOTTOM            |
| `row`     | top → bottom | TOP, BOTTOM          | LEFT, RIGHT            |

### 2. Drop Zone Algorithm

#### 2.1 Zone Layers

For a panel at depth D, hovering it produces:

- **1 center zone** (Layer 0) — always present
- **D + 1 directional layers**, each with 4 zones (TOP, BOTTOM, LEFT, RIGHT)

Layers radiate outward from center to edge. Each layer targets a progressively higher ancestor.

#### 2.2 The Four Actions

| Action      | What it does                              | Sizing           | Available at  |
|-------------|-------------------------------------------|------------------|---------------|
| **STACK**   | Add tab to this panel's group             | No change        | Layer 0       |
| **SPLIT**   | Replace panel with a new 50/50 container  | 50/50            | Layer 1       |
| **EQUALIZE**| Insert new sibling; all children → 1/N   | Equal            | Layer 2+, along axis |
| **WRAP**    | Nest ancestor in a new perpendicular container | 50/50       | Layer 2+, perpendicular to axis |

#### 2.3 Which Action Fires

| Layer | Ancestor   | Dir vs axis    | Action        |
|-------|-----------|----------------|---------------|
| 0     | —         | —              | **STACK**     |
| 1     | self      | —              | **SPLIT**     |
| 2+    | parent+   | Along          | **EQUALIZE**  |
| 2+    | parent+   | Perpendicular  | **WRAP**      |

**SPLIT** subdivides a single panel in half. **EQUALIZE** adds a peer alongside existing siblings and resets all to equal size (2→3→4→N, always 1/N each). **WRAP** introduces a new split axis by nesting an ancestor — enabling a subsequent EQUALIZE in that new direction.

### 3. Zone Shape

Diagonal lines from each corner through the center divide the panel into 4 triangular sectors (TOP, BOTTOM, LEFT, RIGHT). A small rectangle at the intersection is the center zone (Layer 0). Each sector is then subdivided into D+1 equal-width concentric bands, innermost = Layer 1, outermost = Layer D+1.

```
+------------------------------+
|╲   L2  ·  ·  L2            ╱|
|  ╲  · L1 · · L1 ·        ╱  |
|    ╲  ·  ┌──┐  ·        ╱   |
| L2  ╲L1  │L0│  L1  L2  ╱    |
|      ╱L1 │  │ L1       ╲    |
|    ╱  ·  └──┘  ·        ╲   |
|  ╱  · L1 · · L1 ·        ╲  |
|╱   L2  ·  ·  L2            ╲|
+------------------------------+
```

Every pixel belongs to exactly one zone. Adjacent panels' outermost zones at a shared edge always produce the same drop result, making the boundary seamless.

### 4. Example: Two Panels Side by Side

```
TREE: column[A, B]   (each panel at depth 1 → 2 directional layers, 9 zones each)
```

| Zone on A  | Action                       | Result tree              |
|------------|------------------------------|--------------------------|
| Center     | **STACK** onto A             | `column[A, B]`           |
| L1:Top     | **SPLIT** A                  | `column[row[New,A], B]`  |
| L1:Left    | **SPLIT** A                  | `column[col[New,A], B]`  |
| L2:Left    | **EQUALIZE** (along col)     | `column[New, A, B]` — thirds |
| L2:Right   | **EQUALIZE** (along col)     | `column[A, New, B]` — thirds |
| L2:Top     | **WRAP** root (perp to col)  | `row[New, column[A,B]]`  |
| L2:Bottom  | **WRAP** root (perp to col)  | `row[column[A,B], New]`  |

```
L2:Top (full-width strip above):    L2:Left (equal thirds):
┌──────────────────────┐            ┌───────┬───────┬──────┐
│         New          │            │       │       │      │
├──────────┬───────────┤            │  New  │   A   │  B   │
│    A     │     B     │            │       │       │      │
└──────────┴───────────┘            └───────┴───────┴──────┘
```

### 5. Example: Mixed Layout (Depth 2)

This is where the layered system earns its complexity. When a panel is nested inside an existing split, its drop zones reach up through multiple ancestor containers — producing fundamentally different results at each layer.

```
TREE: row[T, column[BL, BR]]

┌──────────────────────┐
│          T           │  ← depth 1 (parent = root row)
├──────────┬───────────┤
│    BL    │    BR     │  ← depth 2 (parent = column, grandparent = root row)
└──────────┴───────────┘
```

Panel **BL** has 3 directional layers (depth 2 → layers 1, 2, 3):

| Zone on BL | Ancestor targeted | Dir vs axis       | Action           | Result tree                          |
|------------|-------------------|-------------------|------------------|--------------------------------------|
| L1:Top     | BL itself         | —                 | **SPLIT** BL     | `row[T, col[row[New,BL], BR]]`       |
| L2:Left    | `column[BL,BR]`   | Along (col)       | **EQUALIZE**     | `row[T, col[New, BL, BR]]` — thirds in bottom half |
| L2:Top     | `column[BL,BR]`   | Perp (col)        | **WRAP** col     | `row[T, row[New, col[BL,BR]]]`       |
| L3:Top     | root `row`        | Along (row)       | **EQUALIZE**     | `row[T, New, col[BL,BR]]` — thirds full height |
| L3:Left    | root `row`        | Perp (row)        | **WRAP** root    | `col[New, row[T, col[BL,BR]]]`       |

The critical distinction is **L2:Top vs L3:Top** — they look similar but have very different size ratios:

```
L2:Top — wraps only the bottom half:    L3:Top — equal thirds of the full view:
┌──────────────────────┐                ┌──────────────────────┐
│          T           │  50%           │          T           │  33%
├──────────────────────┤                ├──────────────────────┤
│         New          │  25%           │         New          │  33%
├──────────┬───────────┤                ├──────────┬───────────┤
│    BL    │    BR     │  25%           │    BL    │    BR     │  33%
└──────────┴───────────┘                └──────────────────────┘
```

```
L2:Left — thirds within bottom half:    L3:Left — new full-height column on left:
┌──────────────────────┐                ┌─────┬────────────────┐
│          T           │                │     │       T        │
├──────┬───────┬───────┤                │ New ├──────┬─────────┤
│ New  │  BL   │  BR   │                │     │  BL  │   BR    │
└──────┴───────┴───────┘                └─────┴──────┴─────────┘
```

The same drag gesture — drop on the top edge of BL — produces four different outcomes depending on which concentric band the cursor lands in. That's the zone system working as intended.

### 6. Algorithm Pseudocode

#### 6.1 Generating Drop Zones

```
function generateDropZones(panel):
    zones = []
    zones.push({ layer: 0, action: STACK onto panel })

    ancestors = [panel, ...panel.ancestors up to root]

    for layerIndex from 0 to ancestors.length - 1:
        for direction in [TOP, BOTTOM, LEFT, RIGHT]:
            if layerIndex == 0:
                action = splitPanel(panel, direction)
            else:
                ancestor = ancestors[layerIndex]
                childSubtree = ancestors[layerIndex - 1]
                if direction is ALONG ancestor.axis:
                    position = adjacentPosition(childSubtree, ancestor, direction)
                    action = equalize(ancestor, position)
                else:
                    action = wrapAncestor(ancestor, direction)

            zones.push({ layer: layerIndex + 1, direction, action })

    return zones
```

#### 6.2 Executing a Drop

```
function executeDrop(action, draggedTab):
    newPanel = createPanel(draggedTab)

    switch action.type:

        case STACK:
            action.panel.addTab(draggedTab)

        case SPLIT:
            newContainer = createSplit(
                axis:     axisFor(action.direction),
                children: ordered(newPanel, action.panel, action.direction),
                sizes:    [50%, 50%]
            )
            replace action.panel with newContainer in its parent

        case EQUALIZE:
            action.ancestor.children.insert(action.position, newPanel)
            n = action.ancestor.children.length
            action.ancestor.sizes = [1/n, ...] // all equal

        case WRAP:
            wrapper = createSplit(
                axis:     axisFor(action.direction),
                children: ordered(newPanel, action.ancestor, action.direction),
                sizes:    [50%, 50%]
            )
            replace action.ancestor with wrapper in its parent
```

#### 6.3 Hit-Testing a Point

```
function hitTestZone(panel, mouseX, mouseY):
    if point inside centerRect(panel):
        return zones.center

    sector = classifySector(panel.bounds, mouseX, mouseY)  // TOP/BOTTOM/LEFT/RIGHT
    progress = distanceFromCenter(panel.bounds, mouseX, mouseY, sector)
    // 0.0 = center zone edge, 1.0 = panel edge

    layerIndex = clamp(floor(progress * (panel.depth + 1)), 0, panel.depth)
    return zones[layerIndex + 1][sector]
```

### 7. Sizing Rules

| Action       | Sizing                                          |
|--------------|-------------------------------------------------|
| **STACK**    | No change                                       |
| **SPLIT**    | New container is 50/50                          |
| **EQUALIZE** | All children of the container become 1/N        |
| **WRAP**     | New wrapper is 50/50                            |

EQUALIZE always resets all sibling sizes, regardless of prior values. A 60/40 split with a third panel inserted becomes 33/33/33.

### 8. Panel Removal

When the last tab is removed from a panel:

1. Remove the panel from its parent container.
2. If the parent now has only 1 child, collapse it — replace the container with that child.
3. Repeat upward if needed.

No single-child containers persist.

### 9. Practical Limits

The algorithm is theoretically unbounded but practically constrained:

- **Minimum band width** (`minBandPx`) — skip outer layers that are too narrow to target.
- **Minimum panel size** (`minBoxWidthFraction` / `minBoxHeightFraction`) — refuse further splitting below the configured workspace-size fractions.
- **Maximum depth** (e.g. 6) — optional cap to prevent absurd nesting.

These are implementation constraints only; the underlying logic is unchanged at any depth.

---

## Context

This layout model follows the tabbed docking paradigm used in IDEs and professional applications. It is conceptually similar to systems that use a docking compass or overlay drop targets. The key difference is that instead of a fixed set of compass arrows, this system formalizes the behavior as a layered, ancestor-aware zone model: inner zones operate on the hovered panel, while progressively outer bands target parent and higher-level split containers.

In standard terminology, this supports tab grouping (stacking), split docking (left/right/top/bottom splits), dock insertion into existing rows or columns, and container wrapping (introducing a new split axis). The result is a deterministic, infinitely nestable docking layout built on a tree of row/column split containers, with explicit and predictable resizing rules.

---

## License

[MIT](./LICENSE)
