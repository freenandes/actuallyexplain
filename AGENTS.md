# AGENTS.md

## Workflow
- Branch names: short, descriptive kebab-case (e.g. `fix-is-null-order`). Never use auto-generated names like `bot/exciting-bell-nirah0`.
- One focused change per PR. Don't refactor unrelated code.
- PRs are squash-merged and their branches deleted. Start follow-up work from the latest `main`, never on a merged branch.

## Checks
- There's no test suite. Before pushing, `npm run build` (type-check + bundle) and `npm run lint` must both pass.
- For UI changes, check the built app (`npm run build`, then `npx vite preview`). Monaco loads from cdn.jsdelivr.net; offline, serve it from `node_modules/monaco-editor/min/vs`.

## Code facts
- Expression text in a node's label, description and details panel all comes from `exprToString` in `src/buildFlowFromAST.ts`; the description and panel text are derived from the label.
- Check pgsql-ast-parser's real types and grammar (`node_modules/pgsql-ast-parser/src/syntax/ast.ts`, `expr.ne`) instead of assuming. Its AST drops parentheses (`precedence()` in `buildFlowFromAST.ts` mirrors the grammar to add them back), and `<>` arrives as `!=`.
- `src/parseQuery.ts` turns editor text into a diagram. `sanitizeInput` fixes pasted SQL only outside strings, quoted identifiers and comments, and maps positions back to the editor.
- pgsql-ast-parser accepts `WITH RECURSIVE` only with a column list (`t(n) AS …`), so `parseSql` retries with the keyword blanked.
