# Confluence CLI

Multi-host Confluence REST API CLI built with Bun.

## Prerequisites

- Bun >=1.0.0

## Installation

```sh
# Install dependencies
bun install

# Link globally
bun link
```

## Configuration

```sh
# Copy example configs
cp config.yaml.example config.yaml
cp .tokens.yaml.example .tokens.yaml

# Edit configuration
vim config.yaml       # Configure hosts
vim .tokens.yaml      # Add your PATs
```

## Usage

```sh
confluence --help
```

### Commands

| Command | Description |
|---------|-------------|
| `search` | Search pages with CQL query |
| `read` | Read page content |
| `write` | Update page content |
| `user` | Resolve userkey to username |
| `visit` | Open page in browser |
| `config` | Manage hosts and configuration |

### Examples

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

# Resolve a userkey
confluence user 8a0598da86420168018723648aa80085

# Open page in browser
confluence visit 12345
```

## Token Generation

1. Log into your Confluence instance
2. Go to **Profile > Settings > Personal Access Tokens**
3. Click **Create token**
4. Name it (e.g., "confluence-cli")
5. Copy the token immediately (shown only once)
6. Add to `.tokens.yaml`
