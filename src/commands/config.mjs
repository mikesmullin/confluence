/**
 * confluence config - Manage configuration
 */

import { parseArgs } from 'util';
import yaml from 'js-yaml';
import { loadConfig, loadTokens, getAllHosts, getDefaultHost, getRootDir } from '../lib/config.mjs';

const HELP = `
confluence config - Manage Confluence CLI configuration

USAGE:
  confluence config [subcommand]

SUBCOMMANDS:
  list                List all configured hosts
  show <host>         Show configuration for a host
  path                Show config file paths

OPTIONS:
  -h, --help          Show this help message

EXAMPLES:
  confluence config list
  confluence config show confluence1
  confluence config path
`;

export async function runConfig(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }

  const subcommand = positionals[0];

  switch (subcommand) {
    case 'list':
      listHosts();
      break;
    case 'show':
      showHost(positionals[1]);
      break;
    case 'path':
      showPaths();
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.log(HELP);
      process.exit(1);
  }
}

function listHosts() {
  const hosts = getAllHosts();
  const defaultHost = getDefaultHost();

  console.log('Configured hosts:');
  for (const host of hosts) {
    const marker = host === defaultHost ? ' (default)' : '';
    console.log(`  - ${host}${marker}`);
  }
}

function showHost(hostName) {
  if (!hostName) {
    console.error('Error: Must specify host name');
    process.exit(1);
  }

  const config = loadConfig();
  const hostConfig = config.hosts?.[hostName];

  if (!hostConfig) {
    console.error(`Error: Unknown host: ${hostName}`);
    process.exit(1);
  }

  // Show config without token
  console.log(yaml.dump({ [hostName]: hostConfig }, { lineWidth: -1 }));
}

function showPaths() {
  const rootDir = getRootDir();
  console.log(`Config: ${rootDir}/config.yaml`);
  console.log(`Tokens: ${rootDir}/.tokens.yaml`);
}
