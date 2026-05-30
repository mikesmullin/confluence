# PRD: CLI Refactor to Pull/Push/View Workflow

## Objective
Refactor the CLI to follow a git-like workflow with flat top-level commands while preserving existing multi-host behavior.

Requested command shape:

- `pull [url|id]` (network required)
- `push` (network required)
- `search <cql>` (network required)
- `view <url|id>` (local-only)

Additionally:

- Store working data in a dot folder relative to process CWD.
- Store page content as markdown files with YAML front matter named by page ID.
- Use deterministic/lossless XML<->MD conversion (specified in RFC).

## Current State Summary (from src/)
- Entrypoint: `src/cli.mjs` dispatches flat commands (`search`, `read`, `write`, `user`, `metadata`, `resolve`, `visit`, `config`).
- Confluence API adapter: `src/lib/api.mjs` handles REST calls, page resolution, URL parsing, and update/create APIs.
- Config model: `src/lib/config.mjs` loads `config.yaml` and `.tokens.yaml` from repository root (not CWD-relative runtime state).
- `read` (`src/commands/read.mjs`) fetches page and outputs storage HTML/text.
- `write` (`src/commands/write.mjs`) updates/creates pages from file/stdin content with confirmation flow.
- `search` (`src/commands/search.mjs`) runs CQL with table/yaml/json output.

## Product Requirements
1. Command hierarchy
- Introduce flat top-level commands: `confluence pull`, `confluence push`, `confluence search`, `confluence view`.
- Preserve `--help` ergonomics at root level.

2. Pull semantics
- `confluence pull [url|id]`
- If target specified:
  - Resolve host/page by URL or ID (keeping current URL parser behavior).
  - Fetch current storage XML and metadata/version.
  - Convert XML->Markdown deterministically.
  - Write/update `.confluence/<id>.md` with embedded sync metadata in front matter.
- If no target specified:
  - Iterate all pages in local store.
  - For each page, compare local baseline with remote version.
  - Pull newer remote versions only when no pending local write exists.
  - If pending local write exists, warn user to stash local changes, pull, then reapply.

3. Push semantics
- `confluence push`
- Enumerate locally tracked pages with pending changes.
- For each candidate page:
  - Fetch remote metadata/version before update.
  - If remote version is newer than local baseline, do not overwrite.
  - Emit conflict error recommending user to pull first.
  - Otherwise convert Markdown->XML deterministically and update remote page.
- On success, update local state (`remote_version_at_pull`, hashes, pending flags).

4. Search semantics
- `confluence search <cql>` reuses existing search engine and output formats.

5. View semantics
- `confluence view <url|id>`
- Resolve to page ID and render local markdown from `.confluence/<id>.md`.
- Must not require network access.
- If file missing, instruct user to pull first.

6. Storage model
- Runtime storage root: `$CWD/.confluence/`
- Content files: `.confluence/<id>.md`
- Sync metadata location: YAML front matter in each `.confluence/<id>.md`

7. Data model and metadata
- Markdown files must include front matter fields from RFC.
- Front matter must track remote baseline, local digest, dirty/pending flags, pull/push timestamps.

8. Safety and integrity
- Prevent push if remote advanced.
- Prevent background pull overwrite when local pending push exists.
- Validate filename ID equals front matter `page_id`.

## Technical Design
### A. CLI Restructure
Files:

- Update `src/cli.mjs` to dispatch flat top-level commands:
  - `pull`, `push`, `search`, `view`
- Add command modules:
  - `src/commands/pull.mjs`
  - `src/commands/push.mjs`
  - `src/commands/search.mjs` (can wrap existing search)
  - `src/commands/view.mjs`

### B. Local Store Library
Add `src/lib/store.mjs` with deterministic file handling:

- `getStoreRoot(cwd)` -> `.confluence`
- `ensureStoreDirs(cwd)` -> create `.confluence` dir
- `pageMdPath(cwd, pageId)`
- `readPageFile`, `writePageFile`
- `readFrontMatter`, `writeFrontMatter`
- `listTrackedPageIds(cwd)`
- `computeSha256(content)`

### C. Conversion Library
Add `src/lib/convert.mjs` implementing RFC behavior:

- `xmlToMarkdown(xml, metadata) -> { frontMatter, markdownBody }`
- `markdownToXml(markdownFileText) -> { xml, frontMatter }`
- `canonicalizeMarkdown(text)`
- `canonicalizeXml(xml)`

Parser choices (Bun/Node ecosystem compatible):

- Markdown parser: unified ecosystem (remark + mdast)
- XML parser/builder: fast-xml-parser or xmldom + deterministic serializer
- YAML front matter: gray-matter or explicit yaml + parser framing

### D. Sync Engine
Add `src/lib/sync.mjs`:

- `pullOne(ref, opts)`
- `pullAllTracked(opts)`
- `pushPending(opts)`
- conflict detection and status reporting helpers

### E. Existing Module Reuse
- Keep host resolution and REST endpoints in `src/lib/api.mjs`.
- Keep config management (`src/lib/config.mjs`) for remote host credentials.
- Reuse existing `search` implementation logic where possible.

## Implementation Phases
1. Foundations
- Add store library and on-disk schema constants.
- Add conversion library skeleton with deterministic canonicalization hooks.
- Add tests for pathing and metadata serialization.

2. Command skeleton and wiring
- Introduce `pull`/`push`/`search`/`view` top-level commands in `src/cli.mjs`.
- Scaffold `pull`, `push`, `view` commands with help output.
- Wire `search` to existing search behavior.

3. Pull implementation
- Implement target pull and pull-all logic.
- Persist markdown files with embedded sync metadata.
- Add pending-local-change protection for pull-all.

4. Push implementation
- Detect pending local changes.
- Compare remote version against local baseline and enforce conflict behavior.
- Convert md->xml and perform updates.

5. View implementation
- Resolve ID from URL/ID input without network calls where possible.
- Print local markdown body (or optional rendered/plain mode).

6. Documentation updates
- Update `README.md` and `SKILL.md` command docs.

7. Validation
- Unit tests for conversion and store operations.
- Integration tests for pull/push conflict rules.
- Manual smoke tests against at least one configured host.

## Acceptance Criteria
- `confluence pull <id>` creates/updates `.confluence/<id>.md` with valid front matter.
- `confluence pull` (no args) scans tracked pages and updates only safe candidates.
- `confluence push` pushes only pending pages and blocks if remote is newer.
- `confluence view <id>` reads local page without network dependency.
- XML->MD->XML and MD->XML->MD are deterministic under RFC canonicalization.
- Macro-containing pages round-trip without loss.

## Risks and Mitigations
- Risk: conversion edge cases for complex storage XML.
  - Mitigation: start with opaque-preserve strategy for `ac:*`/`ri:*` and unsupported nodes.
- Risk: ambiguity for `view <url>` without network.
  - Mitigation: use local front matter URL/ID metadata captured during pull; fallback to ID-only guidance if absent.
## Open Decisions Requiring Your Approval
1. Should `view` print full markdown including front matter, or body only by default?
A: body only
2. For `pull` with no args, should we process all tracked pages?
A: all tracked pages.
3. For local dirty detection, is hash-based detection sufficient, or do you want explicit staging/stash subcommands in this refactor?
A: hash-based is sufficient