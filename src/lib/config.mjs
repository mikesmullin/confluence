/**
 * Configuration management for Confluence CLI
 * Loads config.yaml and .tokens.yaml
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

let cachedConfig = null;
let cachedTokens = null;

/**
 * Get the root directory of the confluence project
 */
export function getRootDir() {
  return ROOT_DIR;
}

/**
 * Load and parse config.yaml
 */
export function loadConfig() {
  if (cachedConfig) return cachedConfig;

  const configPath = join(ROOT_DIR, 'config.yaml');
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const content = readFileSync(configPath, 'utf8');
  cachedConfig = yaml.load(content);
  return cachedConfig;
}

/**
 * Load and parse .tokens.yaml
 */
export function loadTokens() {
  if (cachedTokens) return cachedTokens;

  const tokensPath = join(ROOT_DIR, '.tokens.yaml');
  if (!existsSync(tokensPath)) {
    throw new Error(
      `Tokens file not found: ${tokensPath}\n` +
      `Copy .tokens.yaml.example to .tokens.yaml and add your PATs`
    );
  }

  const content = readFileSync(tokensPath, 'utf8');
  cachedTokens = yaml.load(content);
  return cachedTokens;
}

/**
 * Get the default host name
 */
export function getDefaultHost() {
  const config = loadConfig();
  return config.default_host;
}

/**
 * Get configuration for a specific host
 */
export function getHostConfig(hostName) {
  const config = loadConfig();
  const tokens = loadTokens();

  const name = hostName || config.default_host;
  const hostConfig = config.hosts?.[name];

  if (!hostConfig) {
    const available = Object.keys(config.hosts || {}).join(', ');
    throw new Error(`Unknown host: ${name}. Available: ${available}`);
  }

  const token = tokens.hosts?.[name]?.token;
  if (!token || token === 'YOUR_PAT_TOKEN_HERE') {
    throw new Error(`No valid token configured for host: ${name}`);
  }

  return {
    name,
    url: hostConfig.url,
    api: hostConfig.api || '/rest/api',
    token,
    domains: hostConfig.domains || [],
  };
}

/**
 * Get all configured hosts
 */
export function getAllHosts() {
  const config = loadConfig();
  return Object.keys(config.hosts || {});
}

/**
 * Determine which host to use based on a URL
 * @param {string} url - The Confluence URL
 * @returns {object} - Host configuration object
 */
export function getHostByUrl(url) {
  const config = loadConfig();
  const tokens = loadTokens();

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Find matching host configuration by domain
    for (const [hostKey, hostConfig] of Object.entries(config.hosts || {})) {
      const domains = hostConfig.domains || [];
      if (domains.includes(hostname)) {
        const token = tokens.hosts?.[hostKey]?.token;
        if (!token || token === 'YOUR_PAT_TOKEN_HERE') {
          throw new Error(`No valid token configured for host: ${hostKey}`);
        }
        return {
          name: hostKey,
          url: hostConfig.url,
          api: hostConfig.api || '/rest/api',
          token,
          domains,
        };
      }
    }

    throw new Error(`No Confluence host configured for domain: ${hostname}`);
  } catch (error) {
    if (error.message.includes('Invalid URL')) {
      throw new Error(`Invalid Confluence URL provided: ${url}`);
    }
    throw error;
  }
}
