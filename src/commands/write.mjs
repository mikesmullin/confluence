/**
 * confluence write - Update page content
 */

import { parseArgs } from 'util';
import { createInterface } from 'readline';
import { readFileSync } from 'fs';
import { getPageById, getPageByTitle, parsePageUrl, updatePage } from '../lib/api.mjs';
import { getHostConfig, getHostByUrl, getDefaultHost } from '../lib/config.mjs';

const HELP = `
confluence write - Update Confluence page content

USAGE:
  confluence write <url|id> [OPTIONS]

OPTIONS:
  --host <name>       Confluence host (default: auto-detect from URL or config)
  --file <path>       Read new content from file (HTML storage format)
  --stdin             Read new content from stdin
  --space <key>       Space key (when using title)
  --title <name>      Page title (alternative to URL/ID)
  --yes               Skip confirmation prompt
  -h, --help          Show this help message

EXAMPLES:
  confluence write 12345 --file content.html
  cat content.html | confluence write 12345 --stdin
  confluence write --space SRE --title "Runbook" --file runbook.html --yes
`;

export async function runWrite(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      host: { type: 'string', short: 'H' },
      file: { type: 'string', short: 'f' },
      stdin: { type: 'boolean' },
      space: { type: 'string', short: 's' },
      title: { type: 'string', short: 't' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  // Get new content
  let newContent;
  if (values.file) {
    newContent = readFileSync(values.file, 'utf8');
  } else if (values.stdin) {
    newContent = await readStdin();
  } else {
    console.error('Error: Must specify --file or --stdin for new content');
    console.log(HELP);
    process.exit(1);
  }

  let host;
  let page;

  // Mode 1: Space + Title
  if (values.space && values.title) {
    const hostName = values.host || getDefaultHost();
    host = getHostConfig(hostName);
    console.error(`Reading page: ${values.space}/${values.title} from ${host.name}`);
    page = await getPageByTitle(host, values.space, values.title);
  }
  // Mode 2: URL or ID
  else if (positionals.length > 0) {
    const input = positionals[0];

    if (input.startsWith('http')) {
      host = getHostByUrl(input);
      const parsed = parsePageUrl(input);
      if (parsed.type === 'id') {
        page = await getPageById(host, parsed.pageId);
      } else if (parsed.type === 'title') {
        page = await getPageByTitle(host, parsed.spaceKey, parsed.title);
      } else {
        throw new Error('Short URLs not supported for write. Use the full URL or page ID.');
      }
    } else {
      const hostName = values.host || getDefaultHost();
      host = getHostConfig(hostName);
      page = await getPageById(host, input);
    }
  } else {
    console.error('Error: Must specify page URL, ID, or --space/--title');
    console.log(HELP);
    process.exit(1);
  }

  if (!page) {
    throw new Error('Page not found');
  }

  const currentContent = page.body?.storage?.value || '';
  const pageId = page.id;
  const pageTitle = page.title;
  const spaceKey = page.space?.key;
  const currentVersion = page.version?.number;

  console.error(`\nPage: ${pageTitle}`);
  console.error(`Space: ${spaceKey}`);
  console.error(`Version: ${currentVersion}`);
  console.error(`ID: ${pageId}`);

  // Show diff
  console.error('\n--- CURRENT CONTENT (text preview) ---');
  console.error(stripHtmlTags(currentContent).slice(0, 500));
  console.error('\n--- NEW CONTENT (text preview) ---');
  console.error(stripHtmlTags(newContent).slice(0, 500));
  console.error('');

  // Confirm
  if (!values.yes) {
    const confirmed = await confirm('Apply this update?');
    if (!confirmed) {
      console.error('Aborted.');
      process.exit(0);
    }
  }

  // Update
  console.error('Updating page...');
  await updatePage(host, pageId, pageTitle, spaceKey, newContent, currentVersion);
  console.error('Done.');
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function confirm(message) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

function stripHtmlTags(html) {
  let text = html;
  text = text.replace(/<\/?(p|div|h[1-6]|br|li|ul|ol|table|tr|td|th)[^>]*>/gi, '\n');
  text = text.replace(/<\/?(blockquote|pre|hr)[^>]*>/gi, '\n');
  text = text.replace(/<[^>]*>/g, '');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s+/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}
