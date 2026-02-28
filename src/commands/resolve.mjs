/**
 * confluence resolve - Convert between permalink and GUID URLs
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
confluence resolve - Convert between permalink and GUID URLs

USAGE:
  confluence resolve <url|id> [OPTIONS]

OPTIONS:
  --host <name>       Confluence host (default: auto-detect from URL or config)
  --format <fmt>      Output format: text, yaml, json (default: text)
  -h, --help          Show this help message

EXAMPLES:
  confluence resolve https://confluence.example.com/pages/viewpage.action?pageId=1205690674
  confluence resolve https://confluence.example.com/display/SPACE/Page+Title
  confluence resolve 1205690674 --host delta
`;

export async function runResolve(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      host: { type: 'string', short: 'H' },
      format: { type: 'string', default: 'text' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }

  const input = positionals[0];
  const { host, page, sourceUrl } = await resolveToPage(values, input);
  const urls = getPageUrls(host, page);

  const output = {
    id: page.id,
    title: page.title,
    space: page.space?.key,
    input,
    source: sourceUrl,
    permalink: urls.permalink,
    guid: urls.guid,
    webui: urls.webui,
  };

  switch (values.format) {
    case 'json':
      console.log(JSON.stringify(output, null, 2));
      break;
    case 'yaml':
      console.log(yaml.dump(output, { lineWidth: -1 }));
      break;
    case 'text':
    default:
      console.log(`Title: ${output.title}`);
      console.log(`ID: ${output.id}`);
      console.log(`Space: ${output.space}`);
      console.log(`Source URL: ${output.source}`);
      console.log(`Permalink: ${output.permalink}`);
      console.log(`GUID URL: ${output.guid}`);
      break;
  }
}

async function resolveToPage(values, input) {
  let host;
  let page;
  let sourceUrl = input;

  if (input.startsWith('http')) {
    host = getHostByUrl(input);
    const parsed = parsePageUrl(input);

    if (parsed.type === 'short') {
      sourceUrl = await resolveShortUrl(input, host);
      const reparsed = parsePageUrl(sourceUrl);

      if (reparsed.type === 'id') {
        page = await getPageMetadataById(host, reparsed.pageId);
      } else if (reparsed.type === 'title') {
        page = await getPageMetadataByTitle(host, reparsed.spaceKey, reparsed.title);
      }

      return { host, page, sourceUrl };
    }

    if (parsed.type === 'id') {
      page = await getPageMetadataById(host, parsed.pageId);
    } else if (parsed.type === 'title') {
      page = await getPageMetadataByTitle(host, parsed.spaceKey, parsed.title);
    }

    return { host, page, sourceUrl };
  }

  const hostName = values.host || getDefaultHost();
  host = getHostConfig(hostName);
  page = await getPageMetadataById(host, input);
  sourceUrl = `${host.url}/pages/viewpage.action?pageId=${input}`;

  return { host, page, sourceUrl };
}
