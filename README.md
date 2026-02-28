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

See `SKILL.md` for command usage, command reference, and examples.

To create a new page under a specific parent page, use:

```sh
confluence write --create --parent <url|id> --title "New Page" --file content.html
```

## Token Generation

1. Log into your Confluence instance
2. Go to **Profile > Settings > Personal Access Tokens**
3. Click **Create token**
4. Name it (e.g., "confluence-cli")
5. Copy the token immediately (shown only once)
6. Add to `.tokens.yaml`
