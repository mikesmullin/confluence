/**
 * confluence pull - Pull pages from Confluence into local markdown store.
 */

import { parseArgs } from 'util';
import { pullAllTracked, pullOne } from '../lib/sync.mjs';

const HELP = `
confluence pull - Pull page content into local .confluence store

USAGE:
  confluence pull [url|id] [OPTIONS]

OPTIONS:
  --host <name>       Confluence host override (for ID input)
  --force             Overwrite local pending changes (single-target mode only)
  -h, --help          Show this help message

BEHAVIOR:
  confluence pull <url|id>   Pull one page and write .confluence/<id>.md
  confluence pull            Pull all tracked pages only when safe
`;

export async function runPull(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      host: { type: 'string', short: 'H' },
      force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  if (positionals.length > 0) {
    const ref = positionals[0];
    const pulled = await pullOne(ref, {
      cwd: process.cwd(),
      hostName: values.host,
      force: values.force,
    });

    console.log(`Pulled ${pulled.pageId} (${pulled.title}) -> ${pulled.path}`);
    return;
  }

  const result = await pullAllTracked({
    cwd: process.cwd(),
  });

  console.log(`Scanned: ${result.scanned}`);
  console.log(`Pulled: ${result.pulled.length}`);
  console.log(`Skipped (pending local changes): ${result.skippedPending.length}`);
  console.log(`Skipped (already current): ${result.skippedCurrent.length}`);
  console.log(`Errors: ${result.errors.length}`);

  for (const item of result.skippedPending) {
    console.error(`SKIP ${item.pageId}: ${item.reason}`);
  }
  for (const item of result.errors) {
    console.error(`ERROR ${item.pageId}: ${item.error}`);
  }
}
