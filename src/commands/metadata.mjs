/**
 * confluence metadata - Read page metadata (without body)
 */

import { parseArgs } from 'util';
import yaml from 'js-yaml';
import {
  parsePageUrl,
  resolveShortUrl,
  getPageMetadataById,
  getPageMetadataByTitle,
  getPageUrls,
} from '../lib/api.mjs';
import { getHostConfig, getHostByUrl, getDefaultHost } from '../lib/config.mjs';

const HELP = `
confluence metadata - Read Confluence page metadata (no body content)

USAGE:
  confluence metadata <url|id> [OPTIONS]
  confluence metadata --space <key> --title <name> [OPTIONS]

OPTIONS:
  --host <name>       Confluence host (default: auto-detect from URL or config)
  --space <key>       Space key (when using title instead of URL)
  --title <name>      Page title (alternative to URL/ID)
  --format <fmt>      Output format: text, yaml, json (default: text)
  -h, --help          Show this help message

EXAMPLES:
  confluence metadata 1205690674
  confluence metadata https://confluence.example.com/pages/viewpage.action?pageId=1205690674
  confluence metadata https://confluence.example.com/display/SPACE/Page+Title
  confluence metadata --space SRE --title "Runbook Index"
`;

export async function runMetadata(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      host: { type: 'string', short: 'H' },
      space: { type: 'string', short: 's' },
      title: { type: 'string', short: 't' },
      format: { type: 'string', default: 'text' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  const { host, page } = await resolveTarget(values, positionals);
  const ancestors = page.ancestors || [];
  const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
  const urls = getPageUrls(host, page);

  const metadata = {
    id: page.id,
    title: page.title,
    type: page.type,
    status: page.status,
    version: page.version?.number,
    space: {
      key: page.space?.key,
      name: page.space?.name,
    },
    parent: parent
      ? {
          id: parent.id,
          title: parent.title,
        }
      : null,
    path: ancestors.map((ancestor) => ancestor.title),
    urls,
  };

  switch (values.format) {
    case 'json':
      console.log(JSON.stringify(metadata, null, 2));
      break;
    case 'yaml':
      console.log(yaml.dump(metadata, { lineWidth: -1 }));
      break;
    case 'text':
    default:
      printMetadataText(metadata);
      break;
  }
}

async function resolveTarget(values, positionals) {
  let host;
  let page;

  if (values.space && values.title) {
    const hostName = values.host || getDefaultHost();
    host = getHostConfig(hostName);
    page = await getPageMetadataByTitle(host, values.space, values.title);
    return { host, page };
  }

  if (positionals.length === 0) {
    console.log(HELP);
    process.exit(1);
  }

  const input = positionals[0];

  if (input.startsWith('http')) {
    host = getHostByUrl(input);
    const parsed = parsePageUrl(input);

    if (parsed.type === 'short') {
      const resolved = await resolveShortUrl(input, host);
      const reparsed = parsePageUrl(resolved);

      if (reparsed.type === 'id') {
        page = await getPageMetadataById(host, reparsed.pageId);
      } else if (reparsed.type === 'title') {
        page = await getPageMetadataByTitle(host, reparsed.spaceKey, reparsed.title);
      }
      return { host, page };
    }

    if (parsed.type === 'id') {
      page = await getPageMetadataById(host, parsed.pageId);
    } else if (parsed.type === 'title') {
      page = await getPageMetadataByTitle(host, parsed.spaceKey, parsed.title);
    }

    return { host, page };
  }

  const hostName = values.host || getDefaultHost();
  host = getHostConfig(hostName);
  page = await getPageMetadataById(host, input);
  return { host, page };
}

function printMetadataText(metadata) {
  console.log(`Title: ${metadata.title}`);
  console.log(`ID: ${metadata.id}`);
  console.log(`Type: ${metadata.type}`);
  console.log(`Status: ${metadata.status}`);
  console.log(`Version: ${metadata.version}`);
  console.log(`Space: ${metadata.space.key}${metadata.space.name ? ` (${metadata.space.name})` : ''}`);
  console.log(`Parent: ${metadata.parent ? `${metadata.parent.title} (${metadata.parent.id})` : 'None'}`);
  console.log(`Path: ${metadata.path.length > 0 ? metadata.path.join(' / ') : '(root)'}`);
  console.log(`Permalink: ${metadata.urls.permalink}`);
  console.log(`GUID URL: ${metadata.urls.guid}`);
}
