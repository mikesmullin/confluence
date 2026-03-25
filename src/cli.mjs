#!/usr/bin/env bun
/**
 * Confluence CLI - Main entrypoint
 * Multi-host Confluence REST API CLI
 */

// Command imports
import { runSearch } from './commands/search.mjs';
import { runPull } from './commands/pull.mjs';
import { runPush } from './commands/push.mjs';
import { runView } from './commands/view.mjs';
import { runPeek } from './commands/peek.mjs';
import { runResolve } from './commands/resolve.mjs';
import { runUser } from './commands/user.mjs';

const HELP = `
confluence - Multi-host Confluence REST API CLI

USAGE:
  confluence <command> [options]

COMMANDS:
  pull [url|id]       Pull page(s) into local .confluence store
  push                Push local pending changes to Confluence
  search <cql>        Search pages with CQL query
  peek <url|id>       Read remote page body (no local storage changes)
  view <url|id>       View local markdown content (offline)
  resolve <url|id>    Convert between permalink and GUID URLs
  user <userkey>      Resolve userkey to username

OPTIONS:
  -h, --help          Show this help message
  -v, --version       Show version

Use "confluence <command> --help" for more information about a command.
`;

const VERSION = '0.1.0';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    console.log(HELP);
    process.exit(0);
  }

  if (args[0] === '-v' || args[0] === '--version') {
    console.log(`confluence version ${VERSION}`);
    process.exit(0);
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  try {
    switch (command) {
      case 'pull':
        await runPull(commandArgs);
        break;
      case 'push':
        await runPush(commandArgs);
        break;
      case 'search':
        await runSearch(commandArgs);
        break;
      case 'peek':
        await runPeek(commandArgs);
        break;
      case 'view':
        await runView(commandArgs);
        break;
      case 'resolve':
        await runResolve(commandArgs);
        break;
      case 'user':
        await runUser(commandArgs);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "confluence --help" for usage.');
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
