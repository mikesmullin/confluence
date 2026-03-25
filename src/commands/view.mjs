/**
 * confluence view - View locally stored markdown without network calls.
 */

import { parseArgs } from 'util';
import { parsePageUrl } from '../lib/api.mjs';
import { listTrackedPageIds, readPageFile, serializeMarkdownFile } from '../lib/store.mjs';

const HELP = `
confluence view - View local markdown for a page

USAGE:
  confluence view <url|id> [OPTIONS]

OPTIONS:
  --with-front-matter Show full file including YAML front matter
  -h, --help          Show this help message

NOTES:
  - This command is local-only and does not call Confluence APIs.
  - If a page is missing locally, run "confluence pull <url|id>" first.
`;

export async function runView(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      withFrontMatter: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }

  const ref = positionals[0];
  const pageId = resolveLocalPageId(ref);
  if (!pageId) {
    throw new Error('Could not resolve page locally. Pull the page first.');
  }

  const local = readPageFile(process.cwd(), pageId);
  if (!local) {
    throw new Error(`Local page not found: ${pageId}. Run confluence pull ${ref} first.`);
  }

  if (values.withFrontMatter) {
    console.log(serializeMarkdownFile(local.frontMatter, local.body));
    return;
  }

  console.log(local.body);
}

function resolveLocalPageId(ref) {
  if (/^\d+$/.test(ref)) {
    return ref;
  }

  if (ref.startsWith('http')) {
    const parsed = parsePageUrl(ref);
    if (parsed.type === 'id') {
      return parsed.pageId;
    }

    if (parsed.type === 'short') {
      throw new Error('Short URLs cannot be resolved in local-only view mode. Use a full URL or page ID.');
    }

    // For permalink/title URLs, look up by source/permalink/guid metadata.
    for (const id of listTrackedPageIds(process.cwd())) {
      const local = readPageFile(process.cwd(), id);
      if (!local) {
        continue;
      }
      const candidates = [
        local.frontMatter.source_url,
        local.frontMatter.permalink_url,
        local.frontMatter.guid_url,
      ].filter(Boolean);
      if (candidates.includes(ref)) {
        return id;
      }
    }

    return null;
  }

  return null;
}
