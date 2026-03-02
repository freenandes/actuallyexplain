# actuallyEXPLAIN.me

“Actually EXPLAIN” is an Abstract Syntax Tree (AST) visualizer that serves as a visual decompiler. It translates complex, AI-generated SQL into an intuitive, step-by-step data flow diagram.

By parsing opaque queries into a readable node graph, it clearly reveals the exact logical sequence of tables, joins, filters, and aggregations. This instant visual translation helps developers understand the query's purpose and reconstruct their mental model, allowing them to identify the critical "load-bearing" parts of the query and confidently debug or modify the code without relying solely on the AI.

### Dev commands

| Command            | What it does                                          |
| ------------------ | ----------------------------------------------------- |
| `npm run dev`      | Start the dev server with hot reload                  |
| `npm run build`    | Create a production build in `dist/`                  |
| `npm run preview`  | Serve the production build locally to test it         |
| `npx tsc --noEmit` | Type-check without emitting files (catches TS errors) |


### Front-end customization

| What                                    | Where                                    | Notes                                                               |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Design tokens (colors, radii)           | `src/index.css` `:root`                  | All CSS variables live here                                         |
| Global font, body, reset                | `src/index.css` `:root` / `html,body`    | Inclusive Sans (Google Fonts, loaded in `index.html`)               |
| Page layout, panes, headers, mobile nav | `src/App.module.css`                     | Two-pane flex layout, responsive breakpoints                        |
| Monaco editor chrome                    | `src/App.tsx` → `defineTheme` `colors`   | Background, cursor, selection, scrollbar, line numbers              |
| Monaco syntax highlighting              | `src/App.tsx` → `defineTheme` `rules`    | Token names must end in `.sql` suffix, hex values without `#`       |
| Monaco editor options                   | `src/App.tsx` → `<Editor options>`       | Font, size, padding, line height, weight                            |
| SQL highlight decoration                | `src/index.css` `.sql-highlight`         | The range highlight when a node is selected                         |
| React Flow canvas & controls            | `src/index.css` `.react-flow.dark`       | Must use middle-tier vars (no `-default` suffix) to beat dark mode  |
| React Flow controls sizing/border       | `src/index.css` `.react-flow__controls*` | Direct class overrides                                              |
| Node card styling                       | `src/SqlNode.module.css` `.wrapper`      | Background, border, padding, radius, font                           |
| Node border color (per kind)            | `src/buildFlowFromAST.ts` `nodeColors`   | Sets `--node-color` inline; also used for edge colors               |
| Node icons                              | `src/SqlNode.tsx` `kindIcons`            | Lucide icons, supports `size`, `strokeWidth`, `absoluteStrokeWidth` |
| Node selected glow                      | `src/App.tsx` `HIGHLIGHT_GLOW`           | Inline `boxShadow` applied to highlighted node                      |
| Node outer wrapper radius               | `src/index.css` `.react-flow__node-sql`  | Must match `.wrapper` radius for glow to round correctly            |
| Edge colors                             | `src/buildFlowFromAST.ts`                | Inline `stroke` + `markerEnd.color`, uses `nodeColors` map          |
| Details panel                           | `src/NodeDetailsPanel.module.css`        | Slide-in panel, sections, close button                              |


### Roadmap

- Add BYOK AI chats for "further explain"
- Export stuff/view/content/results
- Static heuristic warnings

### To do

- Style side panel
- Style syntax error
- Add html metadata and graphics
- Write readme
- About page/modal
