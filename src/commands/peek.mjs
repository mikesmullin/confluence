/**
 * confluence peek - Read page content from remote without local storage changes
 */

import { parseArgs } from 'util';
import { getPageById, getPageByTitle, parsePageUrl, resolveShortUrl } from '../lib/api.mjs';
import { getHostConfig, getHostByUrl, getDefaultHost } from '../lib/config.mjs';

const HELP = `
confluence peek - Read Confluence page content from remote

USAGE:
  confluence peek <url|id> [OPTIONS]

OPTIONS:
  --host <name>       Confluence host (default: auto-detect from URL or config)
  --html              Output raw HTML storage format (default)
  --text              Output text-only format
  --space <key>       Space key (when using title instead of URL)
  --title <name>      Page title (alternative to URL/ID)
  -h, --help          Show this help message

EXAMPLES:
  confluence peek https://confluence.example.com/display/SPACE/Page+Title
  confluence peek https://confluence.example.com/pages/viewpage.action?pageId=12345
  confluence peek 12345 --host myhost
  confluence peek --space SRE --title "Runbook Index"
`;

export async function runPeek(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      host: { type: 'string', short: 'H' },
      html: { type: 'boolean' },
      text: { type: 'boolean' },
      space: { type: 'string', short: 's' },
      title: { type: 'string', short: 't' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    return;
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

    // Try to parse as URL
    if (input.startsWith('http')) {
      host = getHostByUrl(input);
      const parsed = parsePageUrl(input);

      if (parsed.type === 'short') {
        console.error('Resolving short URL...');
        const resolved = await resolveShortUrl(input, host);
        const reparsed = parsePageUrl(resolved);
        if (reparsed.type === 'id') {
          page = await getPageById(host, reparsed.pageId);
        } else if (reparsed.type === 'title') {
          page = await getPageByTitle(host, reparsed.spaceKey, reparsed.title);
        }
      } else if (parsed.type === 'id') {
        page = await getPageById(host, parsed.pageId);
      } else if (parsed.type === 'title') {
        page = await getPageByTitle(host, parsed.spaceKey, parsed.title);
      }
    } else {
      // Assume it's a page ID
      const hostName = values.host || getDefaultHost();
      host = getHostConfig(hostName);
      page = await getPageById(host, input);
    }
  } else {
    console.log(HELP);
    return;
  }

  if (!page) {
    throw new Error('Page not found');
  }

  // Output metadata summary to stderr
  console.error(`\nTitle: ${page.title}`);
  console.error(`Space: ${page.space?.key}`);
  console.error(`Version: ${page.version?.number}`);
  console.error(`ID: ${page.id}`);
  console.error('');

  const content = page.body?.storage?.value || '';

  if (values.text) {
    console.log(stripHtmlTags(content));
  } else {
    console.log(content);
  }
}

/**
 * Strip HTML/XML tags from content to show only human-readable text
 */
function stripHtmlTags(html) {
  let text = html;

  // Replace block-level tags with newlines
  text = text.replace(/<\/?(p|div|h[1-6]|br|li|ul|ol|table|tr|td|th)[^>]*>/gi, '\n');
  text = text.replace(/<\/?(blockquote|pre|hr)[^>]*>/gi, '\n');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');

  // Decode HTML entities
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s+/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
