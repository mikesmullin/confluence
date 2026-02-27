/**
 * confluence search - Search pages with CQL query
 */

import { parseArgs } from 'util';
import yaml from 'js-yaml';
import { search } from '../lib/api.mjs';
import { getDefaultHost } from '../lib/config.mjs';

const HELP = `
confluence search - Search Confluence pages with CQL

USAGE:
  confluence search <cql> [OPTIONS]

OPTIONS:
  --host <name>       Confluence host (default: from config)
  --limit <n>         Max results (default: 25)
  --format <fmt>      Output format: table, yaml, json (default: table)
  -h, --help          Show this help message

CQL EXAMPLES:
  text ~ "kubernetes"
  type = "page" AND space = "SRE"
  title ~ "runbook" AND lastModified > now("-30d")
  creator = currentUser() ORDER BY created DESC

EXAMPLES:
  confluence search 'type = "page" AND text ~ "kubernetes"'
  confluence search 'space = "SRE" AND title ~ "runbook"' --limit 10
  confluence search 'text ~ "deploy"' --format yaml
`;

export async function runSearch(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      host: { type: 'string', short: 'H' },
      limit: { type: 'string', short: 'l', default: '25' },
      format: { type: 'string', default: 'table' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }

  const cql = positionals.join(' ');
  const hostName = values.host || getDefaultHost();
  const limit = parseInt(values.limit, 10);

  console.error(`Searching ${hostName}: ${cql}\n`);

  const result = await search(hostName, cql, { limit });
  const results = result.results || [];

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  switch (values.format) {
    case 'json':
      console.log(JSON.stringify(results, null, 2));
      break;
    case 'yaml':
      console.log(yaml.dump(results.map(formatResultForYaml), { lineWidth: -1 }));
      break;
    case 'table':
    default:
      printTable(results);
      break;
  }

  console.error(`\nShowing ${results.length} of ${result.totalSize || results.length} results`);
}

function extractSpace(result) {
  // Try resultGlobalContainer first
  if (result.resultGlobalContainer?.displayUrl) {
    const match = result.resultGlobalContainer.displayUrl.match(/\/display\/([^/]+)/);
    if (match) return match[1];
  }
  // Fall back to URL
  const url = result.url || result.content?._links?.webui || '';
  const match = url.match(/\/display\/([^/]+)/);
  return match ? match[1] : '';
}

function formatResultForYaml(result) {
  const content = result.content || result;
  return {
    id: content.id,
    title: content.title,
    type: content.type,
    space: extractSpace(result),
    url: result.url || content._links?.webui,
    lastModified: result.lastModified,
  };
}

function printTable(results) {
  console.log('ID            SPACE       TYPE     TITLE');
  console.log('─'.repeat(80));

  for (const result of results) {
    const content = result.content || result;
    const id = (content.id || '').toString().padEnd(12);
    const space = extractSpace(result).padEnd(11);
    const type = (content.type || '').padEnd(8);
    const title = (content.title || '').slice(0, 90);
    console.log(`${id} ${space} ${type} ${title}`);
  }
}
