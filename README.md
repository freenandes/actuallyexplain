# actuallyEXPLAIN

[actuallyEXPLAIN](https://actuallyexplain.vercel.app/) is visualizer that helps you understand complex PostgreSQL queries in a diagram and dictionarized form.

Paste your code, and check the logic. No database connection required.

This may be useful for full-stack developers, indie hackers, and perhaps anyone using AI to write SQL who needs to verify what the code actually does before running it in production.

Right now, it just maps the logical intent. In the future, we want to help flag dangerous anti-patterns, warning you about potential database locks, and catching bad queries before they ever execute.

Open source under the MIT license. You're welcome to view the code, suggest stuff and contribute.

## Contributing

1. Fork the repo and clone it
2. `npm install` then `npm run dev` to start the local server
3. Make your changes, run `npm run build` to check for errors
4. Open a pull request

### Tech

- **React 19** + **TypeScript**, bundled with **Vite**
- **Monaco Editor** — the same editor that powers VS Code, used for SQL input
- **React Flow** — renders the node/edge diagram; layout is computed with **dagre**
- **pgsql-ast-parser** — parses raw SQL into an AST (no database needed)
- **Lucide** icons, CSS Modules for styling (no UI framework)

### Codebase

All source lives in `src/`. Key files:

| File                    | Role                                                            |
| ----------------------- | --------------------------------------------------------------- |
| `App.tsx`               | Root component — wires together the editor, diagram, and panels |
| `buildFlowFromAST.ts`   | Converts the parsed SQL AST into React Flow nodes and edges     |
| `SqlNode.tsx`           | Custom React Flow node component                                |
| `RecursiveEdge.tsx`     | Custom edge for recursive/CTE references                        |
| `NodeDetailsPanel.tsx`  | Side panel that shows details when a node is selected           |
| `AboutModal.tsx`        | About dialog                                                    |
| `NodeActionsContext.ts` | React context for node interaction callbacks                    |

### To do

- Optimize code (remove redundancies, centralize styles, etc.)

### Ideas

- Dictionary for maintenance commands with static heuristic warnings
- Export functionality
- BYOK AI chat for "further explain"
- Support other SQL flavors
- Digest execution plans and provide performance stats

## Looking for something else?

actuallyEXPLAIN is built for logical intent (understanding what the code means). If that's not what you need right now, check out these great tools:

- Fix slow queries and visualize your actual Postgres execution plans with [explain.dalibo.com](https://explain.dalibo.com/) or [explain.depesz.com](https://explain.depesz.com/).
- Track data across 100s of tables with a tool like [SQLFlow](https://sqlflow.gudusoft.com/).
