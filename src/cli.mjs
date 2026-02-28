#!/usr/bin/env bun
/**
 * Confluence CLI - Main entrypoint
 * Multi-host Confluence REST API CLI
 */

import { parseArgs } from 'util';

// Command imports
import { runSearch } from './commands/search.mjs';
import { runRead } from './commands/read.mjs';
import { runWrite } from './commands/write.mjs';
import { runUser } from './commands/user.mjs';
import { runVisit } from './commands/visit.mjs';
import { runConfig } from './commands/config.mjs';
import { runMetadata } from './commands/metadata.mjs';
import { runResolve } from './commands/resolve.mjs';

const HELP = `
confluence - Multi-host Confluence REST API CLI

USAGE:
  confluence <command> [options]

COMMANDS:
  search <cql>        Search pages with CQL query
  read <url|id>       Read page content (supports URLs and page IDs)
  write <url|id>      Update page content (with diff and confirmation)
  user <userkey>      Resolve userkey to username
  metadata <url|id>   Read page metadata (no document body)
  resolve <url|id>    Convert between permalink and GUID URLs
  visit <url|id>      Open page in browser
  config              Manage hosts and configuration

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
      case 'search':
        await runSearch(commandArgs);
        break;
      case 'read':
        await runRead(commandArgs);
        break;
      case 'write':
        await runWrite(commandArgs);
        break;
      case 'user':
        await runUser(commandArgs);
        break;
      case 'metadata':
        await runMetadata(commandArgs);
        break;
      case 'resolve':
        await runResolve(commandArgs);
        break;
      case 'visit':
        await runVisit(commandArgs);
        break;
      case 'config':
        await runConfig(commandArgs);
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
