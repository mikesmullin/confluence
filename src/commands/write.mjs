/**
 * confluence write - Update page content
 */

import { parseArgs } from 'util';
import { createInterface } from 'readline';
import { readFileSync } from 'fs';
import {
  createPage,
  getPageById,
  getPageByTitle,
  getPageMetadataById,
  getPageMetadataByTitle,
  getPageUrls,
  parsePageUrl,
  resolveShortUrl,
  updatePage,
} from '../lib/api.mjs';
import { getHostConfig, getHostByUrl, getDefaultHost } from '../lib/config.mjs';

const HELP = `
confluence write - Update or create Confluence page content

USAGE:
  confluence write <url|id> [OPTIONS]
  confluence write --create --parent <url|id> --title <name> [OPTIONS]

OPTIONS:
  --host <name>       Confluence host (default: auto-detect from URL or config)
  --file <path>       Read new content from file (HTML storage format)
  --stdin             Read new content from stdin
  --create            Create a new page instead of updating an existing page
  --parent <url|id>   Parent page for create mode
  --space <key>       Space key (when using title)
  --title <name>      Page title (alternative to URL/ID)
  --yes               Skip confirmation prompt
  -h, --help          Show this help message

EXAMPLES:
  confluence write 12345 --file content.html
  cat content.html | confluence write 12345 --stdin
  confluence write --space SRE --title "Runbook" --file runbook.html --yes
  confluence write --create --parent 12345 --title "New Runbook" --file content.html
`;

export async function runWrite(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      host: { type: 'string', short: 'H' },
      file: { type: 'string', short: 'f' },
      stdin: { type: 'boolean' },
      create: { type: 'boolean' },
      parent: { type: 'string', short: 'p' },
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

  if (values.create) {
    await runCreate(values, positionals, newContent);
    return;
  }

  let host;
  let page;

  // Update mode 1: Space + Title
  if (values.space && values.title) {
    const hostName = values.host || getDefaultHost();
    host = getHostConfig(hostName);
    console.error(`Reading page: ${values.space}/${values.title} from ${host.name}`);
    page = await getPageByTitle(host, values.space, values.title);
  }
  // Update mode 2: URL or ID
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

async function runCreate(values, positionals, newContent) {
  const parentRef = values.parent || positionals[0];
  const newTitle = values.title;

  if (!parentRef) {
    throw new Error('Create mode requires --parent <url|id> (or positional parent ID/URL).');
  }

  if (!newTitle) {
    throw new Error('Create mode requires --title <name>.');
  }

  const { host, page: parentPage } = await resolvePageRef(parentRef, values.host, true);
  const spaceKey = values.space || parentPage.space?.key;

  if (!spaceKey) {
    throw new Error('Could not determine space key for new page. Pass --space explicitly.');
  }

  console.error(`\nCreating page: ${newTitle}`);
  console.error(`Space: ${spaceKey}`);
  console.error(`Parent: ${parentPage.title} (${parentPage.id})`);

  console.error('\n--- NEW CONTENT (text preview) ---');
  console.error(stripHtmlTags(newContent).slice(0, 500));
  console.error('');

  if (!values.yes) {
    const confirmed = await confirm('Create this page?');
    if (!confirmed) {
      console.error('Aborted.');
      process.exit(0);
    }
  }

  console.error('Creating page...');
  const created = await createPage(host, newTitle, spaceKey, newContent, parentPage.id);
  const urls = getPageUrls(host, created);

  console.error('Done.');
  console.log(`ID: ${created.id}`);
  console.log(`Title: ${created.title}`);
  console.log(`Permalink: ${urls.permalink}`);
  console.log(`GUID URL: ${urls.guid}`);
}

async function resolvePageRef(ref, hostNameOverride, metadataOnly = false) {
  let host;
  let page;

  if (ref.startsWith('http')) {
    host = getHostByUrl(ref);
    const parsed = parsePageUrl(ref);

    if (parsed.type === 'short') {
      const resolved = await resolveShortUrl(ref, host);
      const reparsed = parsePageUrl(resolved);
      if (reparsed.type === 'id') {
        page = metadataOnly
          ? await getPageMetadataById(host, reparsed.pageId)
          : await getPageById(host, reparsed.pageId);
      } else if (reparsed.type === 'title') {
        page = metadataOnly
          ? await getPageMetadataByTitle(host, reparsed.spaceKey, reparsed.title)
          : await getPageByTitle(host, reparsed.spaceKey, reparsed.title);
      }
      return { host, page };
    }

    if (parsed.type === 'id') {
      page = metadataOnly
        ? await getPageMetadataById(host, parsed.pageId)
        : await getPageById(host, parsed.pageId);
    } else if (parsed.type === 'title') {
      page = metadataOnly
        ? await getPageMetadataByTitle(host, parsed.spaceKey, parsed.title)
        : await getPageByTitle(host, parsed.spaceKey, parsed.title);
    }

    return { host, page };
  }

  const hostName = hostNameOverride || getDefaultHost();
  host = getHostConfig(hostName);
  page = metadataOnly ? await getPageMetadataById(host, ref) : await getPageById(host, ref);

  return { host, page };
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
