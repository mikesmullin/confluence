/**
 * confluence push - Push local pending markdown changes to Confluence.
 */

import { parseArgs } from 'util';
import { resolve } from 'path';
import { pushPending, pushFile } from '../lib/sync.mjs';

const HELP = `
confluence push - Push local pending changes to Confluence

USAGE:
  confluence push [OPTIONS] [FILE]

ARGUMENTS:
  FILE                Optional path to a markdown file outside the .confluence
                      store. Must contain valid confluence-offline front matter.
                      When provided, only this file is pushed.

OPTIONS:
  -h, --help          Show this help message
`;

export async function runPush(args) {
  const { values, positionals } = parseArgs({
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

  if (positionals.length > 0) {
    const filePath = resolve(process.cwd(), positionals[0]);
    try {
      const pushed = await pushFile(filePath, { cwd: process.cwd() });
      console.log(`Pushed: 1`);
      console.log(`  ${filePath} -> page ${pushed.pageId} (v${pushed.version})`);
    } catch (error) {
      console.error(`ERROR: ${error.message}`);
      process.exitCode = 1;
    }
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
