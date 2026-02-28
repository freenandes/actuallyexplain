# actuallyEXPLAIN.me

“Actually EXPLAIN” is an Abstract Syntax Tree (AST) visualizer that serves as a visual decompiler. It translates complex, AI-generated SQL into an intuitive, step-by-step data flow diagram.

By parsing opaque queries into a readable node graph, it clearly reveals the exact logical sequence of tables, joins, filters, and aggregations. This instant visual translation helps developers understand the query's purpose and reconstruct their mental model, allowing them to identify the critical "load-bearing" parts of the query and confidently debug or modify the code without relying solely on the AI.

## Workflow

### Useful commands

| Command               | What it does                                              |
| --                    | --                                                        |
| `npm run dev`         | Start the dev server with hot reload                      |
| `npm run build`       | Create a production build in `dist/`                      |
| `npm run preview`     | Serve the production build locally to test it             |
| `npx tsc --noEmit`    | Type-check without emitting files (catches TS errors)     |

### Customization

`src/App.tsx` + `src/App.module.css`:

- The overall shell layout
- Pane headers
- Error bar
- Text editor (Monaco)

`src/NodeDetailsPanel.tsx` + `src/NodeDetailsPanel.module.css`:

- The details sidebar that opens when you click a node's info button

`src/index.css`:

- global CSS variables (`--bg-primary`, `--border-color`, etc.) that feed into all of the above
- SQL highlight decoration

### Roadmap

- Add BYOK AI chats to pick up for "further explain"
- Export view/content/results
- Static heuristic warnings

### To do

- Style canvases
- Style code
- Style diagram nodes + icons + content
- Add html metadata and graphics
- Add responsiveness to browser viewport resize
- Write readme
- Write disclaimer that there's no AI or routes anywhere that can flush sensitive information out in the open
- About page/modal