# Master-file chooser for directory / multi-file Survex & Therion imports

## Context

A real Survex/Therion project folder often contains **several "master" files that describe the
same caves multiple times** — e.g. the Migovec dataset
(`/tmp/svx-test/migovecsurveydata/migovecsurveydata/`) has `system_migovec.svx`, `mig.svx`,
`sistem_migovec_2017.svx`, `primadona_ubend_monatip.svx`, … each `*include`-ing overlapping
sub-files, so the same caves appear ~4×.

Because the browser cannot read the filesystem, the user can't select one master `.svx` and have
the app follow its `*include`s (the included files aren't loaded). Their only options are:
- **Directory pick** (`#caveDirInput`, `webkitdirectory`) — loads *all* files, but
  `findRootFile` (`src/io/cave-survey-helpers.js:140`) auto-picks the single highest-ranked master
  (`ranked[0]`), giving the user no say in *which* one.
- **Multi-file pick** (`#caveInput`) — can't follow `*include`s across files the user didn't pick.

**Goal:** after a directory (or multi-file) import, when more than one candidate master is
detected, show a chooser so the user picks which master(s) to import; then import **only the
chosen master('s) `*include`/`input` closure**, ignoring the duplicate masters. This bridges the
browser limitation: pick the folder (all files in memory) → pick the master(s) → import its tree.

Decisions (confirmed with user):
- **Multi-select** chooser (checkboxes), top-ranked candidate pre-checked — lets the user import
  one variant *or* several genuinely-different caves in one action.
- Chooser appears **only when ambiguous** (>1 candidate master). One master (or one master + its
  includes → 1 candidate) imports straight through, unchanged.

## Approach

`getCaves(textMap)` already parses from a single root via `#parseX(rootName, textMap)` →
`flattenFile(...)` which follows `*include`/`input` and pulls in **only referenced files**. So
importing "just the chosen master's tree" is simply `getCaves(textMap, chosenRoot)` — the other
masters in `textMap` are never referenced, so never parsed. No duplicates.

The chooser is a standard Promise-based modal (same pattern as
`src/ui/encoding-selection-dialog.js` / `xyz-kind-dialog.js`, `dialog-overlay` CSS), shown from
within `importFiles` (where `textMap` is built), so `getCaves`/`getCave` stay pure and
deterministic for tests.

## Changes

### 1. `src/io/cave-survey-helpers.js` — expose all ranked candidates
- Add `export function findRootFiles(textMap, opts)` that returns the **full ranked candidate
  list** as `[{ key, includeCount, title }]` (reuse the existing candidate/`ranked` logic from
  `findRootFile`, lines 149–187; `includeCount` = the `countPattern` match count already used for
  ranking; `title` = best-effort from `*title "…"` / `-title "…"` / first `*begin`/`survey` name,
  empty string if none).
- Refactor `findRootFile` to `return findRootFiles(textMap, opts)[0]?.key ?? [...textMap.keys()][0]`
  so existing callers/behaviour are unchanged.
- Add `export async function chooseRootImports(textMap, opts, dialog)`:
  - `const cands = findRootFiles(textMap, opts);`
  - `cands.length <= 1` → return `cands.map(c => c.key)` (0 ⇒ caller auto-detects; 1 ⇒ that key).
  - `> 1` → `const sel = await dialog.show(cands);` return `sel` (array of keys) or `null` if cancelled.

### 2. `src/ui/root-file-selection-dialog.js` — new modal (template: `encoding-selection-dialog.js`)
- `class RootFileSelectionDialog { async show(candidates) }` → `Promise<string[] | null>`.
- Renders a checkbox list of candidates (label = relative `key` + `title` + `(N includes)`), the
  first (top-ranked) pre-checked; `dialog-overlay` / `dialog-container dialog-content` markup;
  "Import selected" (resolves selected keys) and "Cancel" / Escape / overlay-click (resolves
  `null`). Disable "Import selected" when nothing is checked.

### 3. `src/io/therion-importer.js` & `src/io/survex-importer.js` — wire the chooser
- Construct `this.rootFileDialog = new RootFileSelectionDialog();` (next to the existing
  `coordinateSystemDialog`).
- Add optional `rootName` to `getCaves(textMap, rootName)`: if provided, parse from it
  (`#parseX(rootName, textMap)`); else `#findRootFile(textMap)` as today. `getCave` unchanged.
- In `importFiles(filesMap, onCaveLoad)`, after building `textMap`:
  ```
  const roots = await chooseRootImports(textMap, OPTS, this.rootFileDialog);
  if (roots === null) return;                 // user cancelled
  const targets = roots.length ? roots : [undefined]; // [] ⇒ auto-detect single tree
  for (const root of targets)
    for (const cave of await this.getCaves(textMap, root))
      if (cave) await onCaveLoad(cave);
  ```
  (`OPTS` = `THERION_OPTS` / `SURVEX_OPTS`.) `src/main.js` `#importCaveFiles` is unchanged.

### 4. i18n — `src/i18n/translations/en.json` + `hu.json`
- Add `ui.panels.rootFileSelection`: `title`, `message`, `importSelected`, `cancelled`
  (follow the `ui.panels.encodingSelection` convention, single-brace `{param}`).

## Verification

- **Unit** (`tests/unit/survex.test.js`, mirror in a therion test):
  - `findRootFiles` returns multiple ranked candidates for a textMap with two unconnected
    masters; returns one for a normal single-master map.
  - `getCaves(textMap, rootKey)` imports **only** the chosen master's tree: build a map with
    master A (includes a1/a2) + master B (includes b1/b2); assert `getCaves(map,'A.svx')` yields
    only A's caves and none of B's.
  - `importFiles` with a stub `rootFileDialog` (`show: () => ['A.svx']`) over a 2-master map calls
    `onCaveLoad` only for A's caves; a stub returning `null` imports nothing.
- **Live (chrome-devtools)**: open the Migovec folder via *Open Cave Folder* → chooser lists the
  candidate masters (checkboxes, top pre-checked) → check only `system_migovec.svx` → Import →
  exactly one System Migovec tree appears (no 4× duplicates). Re-open and select two distinct
  masters → both import. Confirm a normal single-master folder imports with **no** dialog.
- `npm test` green (esp. existing Survex/Therion importer + `findRootFile` behaviour).
