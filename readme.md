# Tab Drag-and-Drop Split Zone Pattern

At its core, dropping a tab does one of three things:

1. **Stack** — add it to an existing panel as a browser-style tab. No layout change.
2. **Split** — cut a single panel in half (50/50), placing the new panel beside it.
3. **Insert** — shove the new panel into an existing row or column of siblings, before or after a specific sibling, resizing all of them equally.

The complication is that a panel can be inside a column that is itself inside a row — so the same drag gesture can target different ancestor containers depending on where exactly the cursor lands. Dropping near the inner edge of a panel splits that panel. Dropping near the outer edge inserts into its parent row or column. Dropping even further out inserts into its grandparent — and so on. The zone system is just a formal way to express that hierarchy spatially.

---

## 1. Layout Model

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

---

## 2. Drop Zone Algorithm

### 2.1 Zone Layers

For a panel at depth D, hovering it produces:

- **1 center zone** (Layer 0) — always present
- **D + 1 directional layers**, each with 4 zones (TOP, BOTTOM, LEFT, RIGHT)

Layers radiate outward from center to edge. Each layer targets a progressively higher ancestor.

### 2.2 The Four Actions

| Action      | What it does                              | Sizing           | Available at  |
|-------------|-------------------------------------------|------------------|---------------|
| **STACK**   | Add tab to this panel's group             | No change        | Layer 0       |
| **SPLIT**   | Replace panel with a new 50/50 container  | 50/50            | Layer 1       |
| **EQUALIZE**| Insert new sibling; all children → 1/N   | Equal            | Layer 2+, along axis |
| **WRAP**    | Nest ancestor in a new perpendicular container | 50/50       | Layer 2+, perpendicular to axis |

### 2.3 Which Action Fires

| Layer | Ancestor   | Dir vs axis    | Action        |
|-------|-----------|----------------|---------------|
| 0     | —         | —              | **STACK**     |
| 1     | self      | —              | **SPLIT**     |
| 2+    | parent+   | Along          | **EQUALIZE**  |
| 2+    | parent+   | Perpendicular  | **WRAP**      |

**SPLIT** subdivides a single panel in half. **EQUALIZE** adds a peer alongside existing siblings and resets all to equal size (2→3→4→N, always 1/N each). **WRAP** introduces a new split axis by nesting an ancestor — enabling a subsequent EQUALIZE in that new direction.

---

## 3. Zone Shape

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

---

## 4. Example: Two Panels Side by Side

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

---

## 5. Example: Mixed Layout (Depth 2)

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

---

## 7. Algorithm Pseudocode

### 7.1 Generating Drop Zones

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

### 7.2 Executing a Drop

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

### 7.3 Hit-Testing a Point

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

---

## 8. Sizing Rules

| Action       | Sizing                                          |
|--------------|-------------------------------------------------|
| **STACK**    | No change                                       |
| **SPLIT**    | New container is 50/50                          |
| **EQUALIZE** | All children of the container become 1/N        |
| **WRAP**     | New wrapper is 50/50                            |

EQUALIZE always resets all sibling sizes, regardless of prior values. A 60/40 split with a third panel inserted becomes 33/33/33.

---

## 9. Panel Removal

When the last tab is removed from a panel:

1. Remove the panel from its parent container.
2. If the parent now has only 1 child, collapse it — replace the container with that child.
3. Repeat upward if needed.

No single-child containers persist.

---

## 10. Practical Limits

The algorithm is theoretically unbounded but practically constrained:

- **Minimum band width** (~20px) — skip outer layers that are too narrow to target.
- **Minimum panel size** (~100px) — refuse further splitting below usable threshold.
- **Maximum depth** (e.g. 6) — optional cap to prevent absurd nesting.

These are implementation constraints only; the underlying logic is unchanged at any depth.


This window management model follows the established tabbed docking (dockable panes) paradigm commonly used in IDEs and professional applications. It is conceptually similar to systems that use a docking compass or overlay drop targets, where dragging a tab reveals directional placement zones for splitting, stacking, or inserting panels. The key difference is that instead of a fixed set of compass arrows, this system formalizes the behavior as a layered, ancestor-aware zone model: inner zones operate on the hovered panel, while progressively outer bands target parent and higher-level split containers. In standard terminology, this supports tab grouping (stacking), split docking (left/right/top/bottom splits), dock insertion into existing rows or columns, and container wrapping (introducing a new split axis). The result is a deterministic, infinitely nestable docking layout built on a tree of row/column split containers, with explicit and predictable resizing rules.