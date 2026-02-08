/**
 * confluence user - Resolve userkey to username
 */

import { parseArgs } from 'util';
import yaml from 'js-yaml';
import { getUser } from '../lib/api.mjs';
import { getHostConfig, getDefaultHost } from '../lib/config.mjs';

const HELP = `
confluence user - Resolve Confluence userkey to user info

USAGE:
  confluence user <userkey> [OPTIONS]

OPTIONS:
  --host <name>       Confluence host (default: from config)
  --format <fmt>      Output format: text, yaml, json (default: text)
  -h, --help          Show this help message

EXAMPLES:
  confluence user 8a0598da86420168018723648aa80085
  confluence user 8a0598da86420168018723648aa80085 --format json
`;

export async function runUser(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      host: { type: 'string', short: 'H' },
      format: { type: 'string', default: 'text' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }

  const userkey = positionals[0];
  const hostName = values.host || getDefaultHost();
  const host = getHostConfig(hostName);

  console.error(`Resolving userkey on ${host.name}: ${userkey}\n`);

  const user = await getUser(host, userkey);

  switch (values.format) {
    case 'json':
      console.log(JSON.stringify(user, null, 2));
      break;
    case 'yaml':
      console.log(yaml.dump(user, { lineWidth: -1 }));
      break;
    case 'text':
    default:
      console.log(`Username: ${user.username}`);
      console.log(`Display Name: ${user.displayName}`);
      console.log(`Email: ${user.email || 'N/A'}`);
      console.log(`User Key: ${user.userKey}`);
      break;
  }
}
