# Repository Guidelines

## Project Structure & Module Organization

The browser game lives in `src/`, with one TypeScript module per subsystem (for example, `physics.ts`, `terrain.ts`, and `screens.ts`). `test/` contains the Vitest suite, and `test/fixtures/dos_*.json` holds fixtures derived from the original DOS executable. DOS capture/disassembly tools live in `oracle/dos/`, with evidence documented in `oracle/`. Historical Python-port dumpers and gitignored `oracle/vectors/` remain legacy material, not the fidelity reference. Static game data belongs in `public/assets/`. Browser checks live in `test-browser/`, retired Python visual comparisons in `visual/`, and coverage helpers in `scripts/`. Screenshots used by the README are stored in `screenshots/`.

## Build, Test, and Development Commands

- `npm ci`: install the exact dependencies recorded in `package-lock.json`.
- `npm run dev`: start the Vite development server, normally at `http://localhost:5173`.
- `npm run build`: run `tsc --noEmit`, then create the production bundle in `dist/`.
- `npm test`: run the resource-capped Vitest suite once, including remaining legacy regression tests.
- `npm run test:watch`: run Vitest interactively while developing.
- `npm run coverage:node`: collect Node-side V8 coverage.
- `npm run coverage:all`: merge Node, browser-render, and application-boot coverage. This requires the local browser/oracle environment.

## Coding Style & Naming Conventions

Use strict TypeScript and ES modules. Match the existing two-space indentation, double-quoted imports, semicolons, and trailing commas in multiline structures. Use `camelCase` for functions and local variables, `PascalCase` for classes and types, and lowercase module filenames. No ESLint or Prettier configuration is provided, so follow nearby code. Preserve provenance comments, deterministic seeded behavior, and exact integer semantics when porting oracle logic.

## Testing Guidelines

Name tests `test/<module>.test.ts`; use `<module>_more.test.ts` for additional coverage. Keep integer unit expectations exact; document tolerances for floating-point calculations and comparisons between different integration timesteps. Start with focused tests, for example `npm test -- test/shields.test.ts test/game_flow.test.ts`. Run `npm test` and `npm run build` before submitting code changes. After checks pass, repeat them only for relevant changes or unresolved failures; documentation-only edits need link/command review and `git diff --check`.

For browser verification, follow [test-browser/README.md](test-browser/README.md). Reuse one Vite development server for the relevant drivers; do not use `vite preview` for the source harness. Shield changes use `shields.mjs`, weapon/effect changes use `weapons.mjs`, and rendering changes use `run.mjs`. Changes to menus or equipment controls also need `ui.mjs`, which exercises DOM interactions. Inspect representative captures as well as the assertions. Do not use `visual/run_gate.sh`: its Python-port comparison is retired from the verification workflow.

## DOS Fidelity Workflow

- **The original Scorched Earth DOS executable is the sole fidelity reference.** New behavioral and visual comparisons must use captured DOS execution or directly checked executable/disassembly evidence, never the Python port. Python is still suitable for capture/extraction scripts; the retired reference is the Python game implementation.
- Read [oracle/COMBAT_FIDELITY.md](oracle/COMBAT_FIDELITY.md), [oracle/WEAPON_FIDELITY.md](oracle/WEAPON_FIDELITY.md), and the relevant retained DOS fixtures before new reverse engineering. Do not add or regenerate Python-port reference vectors or use Python-rendered frames as expected output. When correcting a subsystem, replace its superseded Python expectations with DOS-backed cases. Do not regenerate expected results from the browser implementation merely to make tests pass.
- Reuse `test/fixtures/dos_*.json` for ordinary regression runs. Start DOSBox when evidence is missing, a mismatch needs investigation, or the reference profile changes; do not repeat CPU calibration for every edit. Keep the browser's reference calibration fixed for deterministic replay and network play.
- Use the existing input/capture, memory sampler, calibration and disassembly tools in [oracle/dos/README.md](oracle/dos/README.md). Work in a disposable game copy with a fresh capture directory per process. Follow the guide's startup, configuration and input timing checks before scripting encounters.
- Separate raw DOS per-step values from browser-time quantities. Record the DOS timestep, machine profile and live projectile count before converting a force or timing constant.
- Label evidence precisely: static DOS transcription, recorded DOS runtime samples, browser render checks, or actual UI interaction. Remaining Python-derived tests in `npm test` are legacy regression coverage only, not DOS validation. Retain executable checksum, configuration, initial state, sample alignment and comparison limits with new fixtures. Report the cases and windows actually compared; a passing repository suite or render harness does not prove full-game DOS parity.

## Commit & Pull Request Guidelines

Write concise, imperative commit subjects; optional area prefixes such as `CI:` or `Perf:` match existing history. Pull requests should explain the behavioral impact, list verification commands, and link relevant issues. Include browser captures/check results for visible changes, and DOS comparison evidence for fidelity claims.
