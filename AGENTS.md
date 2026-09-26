# Repository Guidelines

## Project Structure & Module Organization

The browser game lives in `src/`, with one TypeScript module per subsystem (for example, `physics.ts`, `terrain.ts`, and `screens.ts`). `test/` contains the Vitest differential suite. Python scripts in `oracle/` generate golden vectors from the reference port; generated `oracle/vectors/` data is intentionally gitignored. Static game data belongs in `public/assets/`. Browser render checks live in `test-browser/`, visual regression tooling in `visual/`, and coverage helpers in `scripts/`. Screenshots used by the README are stored in `screenshots/`.

## Build, Test, and Development Commands

- `npm ci`: install the exact dependencies recorded in `package-lock.json`.
- `npm run dev`: start the Vite development server, normally at `http://localhost:5173`.
- `npm run build`: run `tsc --noEmit`, then create the production bundle in `dist/`.
- `npm test`: run the resource-capped Vitest differential suite once.
- `npm run test:watch`: run Vitest interactively while developing.
- `npm run coverage:node`: collect Node-side V8 coverage.
- `npm run coverage:all`: merge Node, browser-render, and application-boot coverage. This requires the local browser/oracle environment.

## Coding Style & Naming Conventions

Use strict TypeScript and ES modules. Match the existing two-space indentation, double-quoted imports, semicolons, and trailing commas in multiline structures. Use `camelCase` for functions and local variables, `PascalCase` for classes and types, and lowercase module filenames. No ESLint or Prettier configuration is provided, so follow nearby code. Preserve provenance comments, deterministic seeded behavior, and exact integer semantics when porting oracle logic.

## Testing Guidelines

Name tests `test/<module>.test.ts`; use `<module>_more.test.ts` for additional coverage. Fidelity-sensitive changes should add or regenerate oracle vectors and assert integers exactly, reserving tolerances for documented floating-point behavior. Run `npm test` and `npm run build` before submission. Rendering changes should also use the browser harness or `bash visual/run_gate.sh` when its Python/Playwright environment is available.

## Commit & Pull Request Guidelines

Write concise, imperative commit subjects; optional area prefixes such as `CI:` or `Perf:` match existing history. Pull requests should explain the behavioral impact, list verification commands, and link relevant issues. Include screenshots or visual-gate results for visible UI or rendering changes.
