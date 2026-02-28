# Confluence CLI Skill

Use this tool to search, read, update, resolve, and open Confluence pages across configured hosts.

## Command

```sh
confluence <command> [options]
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search pages with CQL query |
| `read` | Read page content |
| `write` | Update page content |
| `user` | Resolve userkey to username |
| `metadata` | Read page metadata (no body) |
| `resolve` | Convert between permalink and GUID URLs |
| `visit` | Open page in browser |
| `config` | Manage hosts and configuration |

## Examples

```sh
# Search for pages
confluence search 'type = "page" AND text ~ "kubernetes"'

# Read a page by URL
confluence read https://confluence.example.com/display/SPACE/PageTitle

# Read a page by ID
confluence read 12345

# Read a page by space/title
confluence read --space SRE --title "Runbook Index"

# Update a page
confluence write 12345 --file content.html

# Create a new page under a parent page
confluence write --create --parent 12345 --title "New Runbook" --file content.html

# Resolve a userkey
confluence user 8a0598da86420168018723648aa80085

# Read metadata (including parent path)
confluence metadata https://confluence.example.com/pages/viewpage.action?pageId=1205690674

# Convert between GUID URL and permalink URL
confluence resolve https://confluence.example.com/pages/viewpage.action?pageId=1205690674

# Open page in browser
confluence visit 12345
```
