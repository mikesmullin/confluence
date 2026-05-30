# RFC: Deterministic and Lossless Confluence Storage XML <-> Markdown Conversion

## Status
Draft

## Motivation
This specification defines an offline-first workflow where Confluence pages are stored locally as Markdown, then synchronized back to Confluence. To make this safe and auditable, conversion between Confluence Storage XML and Markdown must be:

- Deterministic: same input always produces the same output bytes.
- Lossless: a round trip preserves data.
- Bidirectional: both xml->md and md->xml must be defined.
- Macro-safe: Confluence macros and extension tags must survive unchanged.

## Goals
- Enable reliable synchronization workflows against offline files.
- Keep page content human-editable where feasible.
- Preserve non-Markdown-native structures (macros, structured metadata, unsupported tags) without loss.
- Produce stable serialized output suitable for diffing and conflict detection.

## Non-Goals
- Pretty-printing Confluence XML for humans.
- Semantic normalization of authored prose beyond deterministic formatting rules.
- Supporting every HTML dialect; scope is Confluence Storage XML as returned by Confluence REST API.

## Storage Layout on Disk
All offline data is stored in a dot folder relative to current working directory:

- Folder: `.confluence/`

Page content file:

- Path: `.confluence/<pageId>.md`
- Filename key: page ID integer from Confluence
- Sync state is embedded in front matter of the same `.md` file (no separate state directory).

## Markdown File Format
Each page file uses YAML front matter followed by a Markdown body.

```markdown
---
schema: confluence-offline/v1
page_id: 1205690674
host: delta
space_key: SRE
title: Runbook Index
remote_version: 42
remote_last_modified: 2026-03-20T17:48:10Z
remote_sha256_at_pull: 90ab... (optional)
local_md_sha256: 4e4f... (sha of canonical markdown body)
dirty: false
pending_push: false
last_pull_at: 2026-03-23T18:10:02Z
last_push_at: null
source_format: confluence-storage
---

# Runbook Index

...markdown body...
```

Rules:

- Front matter key order is fixed and deterministic.
- Front matter line endings are `\n`.
- Sync metadata fields are updated atomically together with content writes.
- Markdown body is canonicalized during xml->md conversion.
- File encoding is UTF-8.
- Final newline at EOF is required.

## Canonicalization Rules
These rules apply before serialization to ensure deterministic output.

### XML Canonicalization (for processing)
- Parse as XML (not regex/string transforms).
- Strip insignificant whitespace nodes between block elements.
- Normalize attribute ordering lexicographically by namespace URI, local name.
- Normalize namespace declarations to explicit prefixes where required:
  - `ac` for Confluence macro namespace
  - `ri` for Confluence resource namespace
- Decode entities to code points during AST processing; re-escape as needed in target format.

### Markdown Canonicalization
- Normalize line endings to `\n`.
- Use ATX headings (`#`, `##`, ...).
- Collapse runs of more than 2 blank lines to exactly 2.
- Use fenced code blocks with triple backticks.
- Use ordered list marker `1.` for deterministic list rendering.
- Trim trailing spaces except where required for hard line breaks.
- Ensure single terminal newline.

## Conversion Strategy
Conversion is AST-based with explicit handling tiers.

### Tier 1: Native Markdown mappings (lossless by structure)
Examples:

- `p`, `h1..h6`, `strong`, `em`, `code`, `blockquote`
- `ul`, `ol`, `li`
- `a`, `img` (when representable)
- `table`, `thead`, `tbody`, `tr`, `th`, `td` (Markdown table profile)

If a construct is representable without semantic loss, map directly.

### Tier 2: Confluence extensions (macro/resource tags)
Any Confluence extension content that is not natively representable is preserved in opaque blocks.

Canonical Markdown encoding for opaque blocks:

````markdown
```confluence-xml
<ac:structured-macro ac:name="toc">
  <ac:parameter ac:name="maxLevel">3</ac:parameter>
</ac:structured-macro>
```
````

Rules:

- Payload is canonical XML serialization of that subtree.
- No additional indentation.
- One blank line around opaque blocks unless at document boundaries.
- Language tag is always exactly `confluence-xml`.

### Tier 3: Unsupported/ambiguous nodes
Unsupported nodes are wrapped exactly like Tier 2 opaque blocks. This guarantees no data loss.

## Macro Preservation
Macros are always preserved structurally using canonical XML payload blocks unless a macro has a verified reversible textual projection.

Initial policy:

- Default: preserve all `ac:*` and `ri:*` subtrees as opaque `confluence-xml` blocks.
- Optional future optimization: define per-macro reversible renderers, gated by test coverage and a strict round-trip assertion.

## Deterministic XML -> Markdown Algorithm
Given XML storage input:

1. Parse XML to DOM/AST.
2. Canonicalize XML AST (namespace/attribute ordering, whitespace policy).
3. Walk AST in document order.
4. Emit Markdown tokens:
   - Native nodes via Tier 1 mapping.
   - Macro/extension/unsupported via Tier 2/3 opaque fenced blocks.
5. Canonicalize Markdown text.
6. Return Markdown body.

## Deterministic Markdown -> XML Algorithm
Given a Markdown file body:

1. Parse front matter and body (front matter excluded from content conversion).
2. Parse Markdown to AST.
3. Walk Markdown AST in document order.
4. Reconstruct XML:
   - Native Markdown nodes via inverse Tier 1 mapping.
   - `confluence-xml` fenced blocks parsed as XML subtree and injected verbatim.
5. Canonicalize final XML serialization.
6. Return storage XML string.

## Round-Trip Guarantees
For canonicalized input $X$:

- $xmlToMd(mdToXml(xmlToMd(X))) = xmlToMd(X)$
- $mdToXml(xmlToMd(mdToXml(Y))) = mdToXml(Y)$

Interpretation:

- XML->MD->XML is lossless for supported and opaque-preserved structures.
- MD->XML->MD is stable under canonical Markdown formatting.

## Conflict and Sync Metadata Model
Per-page sync state is stored in front matter of `.confluence/<id>.md`:

- `page_id`
- `host`
- `remote_version_at_pull`
- `remote_sha256_at_pull` (optional)
- `local_md_sha256`
- `dirty` (local edits detected)
- `pending_push` (changes staged for remote write)
- `last_pull_at`
- `last_push_at`

Purpose:

- Detect if remote version advanced since local baseline.
- Prevent accidental overwrite when pushing stale local edits.

Tradeoffs:

- Pros: single-file portability, no sidecar drift, easier manual inspection.
- Cons: operational metadata changes create content-file diffs; higher risk if front matter is manually damaged.
- Mitigation: preserve canonical key order, validate schema on every read, and write via atomic temp-file + rename.

## Error Handling
- Invalid front matter schema/version: hard error.
- Unparseable `confluence-xml` fenced block: hard error with block location.
- XML parse error: hard error with source offset.
- Unknown macro: not an error; preserve as opaque.

## Security and Data Integrity
- Never execute macro content during conversion.
- Treat opaque blocks as inert text except strict XML parse on md->xml.
- Verify page ID consistency between file name and front matter before push.

## Testing Requirements
Minimum suite:

- Golden tests for xml->md deterministic output.
- Golden tests for md->xml deterministic output.
- Round-trip property tests for representative page corpus.
- Macro fixture tests for nested macros, parameters, rich-text-body variants.
- Regression tests for whitespace and entity handling.

## Versioning
- `schema: confluence-offline/v1` in front matter gates parser behavior.
- Future breaking changes increment schema version and require migration tooling.
