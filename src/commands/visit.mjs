/**
 * confluence visit - Open page in browser
 */

import { parseArgs } from 'util';
import { exec } from 'child_process';
import { getPageById, parsePageUrl } from '../lib/api.mjs';
import { getHostConfig, getHostByUrl, getDefaultHost } from '../lib/config.mjs';

const HELP = `
confluence visit - Open Confluence page in browser

USAGE:
  confluence visit <url|id> [OPTIONS]

OPTIONS:
  --host <name>       Confluence host (default: auto-detect from URL or config)
  -h, --help          Show this help message

EXAMPLES:
  confluence visit 12345
  confluence visit https://confluence.example.com/display/SPACE/Page
`;

export async function runVisit(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      host: { type: 'string', short: 'H' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }

  const input = positionals[0];
  let url;

  if (input.startsWith('http')) {
    url = input;
  } else {
    // It's a page ID, construct the URL
    const hostName = values.host || getDefaultHost();
    const host = getHostConfig(hostName);
    const page = await getPageById(host, input);
    const webui = page._links?.webui;
    url = webui ? `${host.url}${webui}` : `${host.url}/pages/viewpage.action?pageId=${input}`;
  }

  console.error(`Opening: ${url}`);

  // Open in browser (macOS)
  exec(`open "${url}"`, (error) => {
    if (error) {
      console.error(`Failed to open browser: ${error.message}`);
      process.exit(1);
    }
  });
}
