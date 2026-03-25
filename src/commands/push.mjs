/**
 * confluence push - Push local pending markdown changes to Confluence.
 */

import { parseArgs } from 'util';
import { pushPending } from '../lib/sync.mjs';

const HELP = `
confluence push - Push local pending changes to Confluence

USAGE:
  confluence push [OPTIONS]

OPTIONS:
  -h, --help          Show this help message
`;

export async function runPush(args) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  const result = await pushPending({
    cwd: process.cwd(),
  });

  console.log(`Scanned: ${result.scanned}`);
  console.log(`Pushed: ${result.pushed.length}`);
  console.log(`Skipped (clean): ${result.skippedClean.length}`);
  console.log(`Conflicts: ${result.conflicts.length}`);
  console.log(`Errors: ${result.errors.length}`);

  for (const item of result.conflicts) {
    console.error(
      `CONFLICT ${item.pageId}: local baseline=${item.localBaselineVersion}, remote=${item.remoteVersion}. Pull first.`,
    );
  }

  for (const item of result.errors) {
    console.error(`ERROR ${item.pageId}: ${item.error}`);
  }
}
