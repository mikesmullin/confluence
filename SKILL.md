# Confluence CLI Skill

Use this tool to pull, push, search, peek, view, resolve, and inspect Confluence content across configured hosts.

## Command

```sh
confluence <command> [options]
```

## Commands

| Command | Description |
|---------|-------------|
| `pull` | Pull one page or all tracked pages into local markdown store |
| `push` | Push local pending markdown changes to Confluence |
| `search` | Search pages with CQL query |
| `peek` | Read remote page content without writing local store files |
| `view` | View locally stored markdown content (offline) |
| `resolve` | Convert between permalink and GUID URLs |
| `user` | Resolve userkey to username/display name |

## pull options

| Option | Description |
|--------|-------------|
| `--out <file>` | Write output to a specific file path instead of `.confluence/<id>.md` |
| `--force` | Overwrite local pending changes (single-target mode only) |
| `--host <name>` | Confluence host override (for numeric ID input) |

## push options

| Option | Description |
|--------|-------------|
| `[file]` | Optional path to a markdown file outside the `.confluence` store. Must contain valid `confluence-offline/v1` front matter. When provided, only this file is pushed. |

## Examples

```sh
# Search for pages
confluence search 'type = "page" AND text ~ "kubernetes"'

# Peek remote copy of content
confluence peek 12345

# Pull a page by URL into the default store
confluence pull https://confluence.example.com/display/SPACE/PageTitle

# Pull a page by ID into the default store
confluence pull 12345

# Pull a page to a specific file outside the store
confluence pull 12345 --out path/to/my-notes.md

# Pull all tracked pages in .confluence/
confluence pull

# View local markdown content (offline)
confluence view 12345

# Resolve URL forms
confluence resolve 12345

# Resolve a userkey
confluence user 8a0598da86420168018723648aa80085

# Push all pending local changes
confluence push

# Push a specific file outside the store
confluence push path/to/my-notes.md
```
