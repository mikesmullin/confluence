/**
 * Local on-disk store for offline Confluence pages.
 */

import { createHash } from 'crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

export const STORE_DIRNAME = '.confluence';
export const SCHEMA_VERSION = 'confluence-offline/v1';

const FRONT_MATTER_KEYS = [
  'schema',
  'page_id',
  'host',
  'space_key',
  'title',
  'remote_version_at_pull',
  'remote_last_modified',
  'remote_sha256_at_pull',
  'local_md_sha256',
  'dirty',
  'pending_push',
  'last_pull_at',
  'last_push_at',
  'source_url',
  'permalink_url',
  'guid_url',
  'source_format',
];

export function getStoreRoot(cwd = process.cwd()) {
  return join(cwd, STORE_DIRNAME);
}

export function ensureStoreDirs(cwd = process.cwd()) {
  const root = getStoreRoot(cwd);
  mkdirSync(root, { recursive: true });
  return root;
}

export function pageMdPath(cwd = process.cwd(), pageId) {
  return join(getStoreRoot(cwd), `${String(pageId)}.md`);
}

export function computeSha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function canonicalizeText(text) {
  const normalized = String(text).replace(/\r\n?/g, '\n');
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

export function canonicalizeMarkdown(text) {
  let out = canonicalizeText(text);
  out = out.replace(/[ \t]+$/gm, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  if (!out.endsWith('\n')) {
    out += '\n';
  }
  return out;
}

export function listTrackedPageIds(cwd = process.cwd()) {
  const root = getStoreRoot(cwd);
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root)
    .map((name) => {
      const match = name.match(/^(\d+)\.md$/);
      return match ? match[1] : null;
    })
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));
}

export function parseMarkdownFile(fileText) {
  const normalized = canonicalizeText(fileText);
  if (!normalized.startsWith('---\n')) {
    throw new Error('Missing YAML front matter delimiter');
  }

  const closeIndex = normalized.indexOf('\n---\n', 4);
  if (closeIndex === -1) {
    throw new Error('Unterminated YAML front matter');
  }

  const fmRaw = normalized.slice(4, closeIndex);
  let body = normalized.slice(closeIndex + 5);
  // Serializer writes one blank separator line after front matter.
  if (body.startsWith('\n')) {
    body = body.slice(1);
  }
  const frontMatter = yaml.load(fmRaw) || {};

  if (typeof frontMatter !== 'object' || Array.isArray(frontMatter)) {
    throw new Error('Invalid YAML front matter object');
  }

  return {
    frontMatter,
    body: canonicalizeMarkdown(body),
  };
}

export function readPageFile(cwd = process.cwd(), pageId) {
  const path = pageMdPath(cwd, pageId);
  if (!existsSync(path)) {
    return null;
  }

  const text = readFileSync(path, 'utf8');
  const parsed = parseMarkdownFile(text);
  validatePageMetadata(String(pageId), parsed.frontMatter);
  return {
    path,
    text: canonicalizeText(text),
    ...parsed,
  };
}

export function writePageFile(cwd = process.cwd(), pageId, frontMatter, markdownBody) {
  ensureStoreDirs(cwd);

  validatePageMetadata(String(pageId), frontMatter);
  const path = pageMdPath(cwd, pageId);
  const tmpPath = `${path}.tmp`;

  const text = serializeMarkdownFile(frontMatter, markdownBody);
  writeFileSync(tmpPath, text, 'utf8');
  renameSync(tmpPath, path);

  return path;
}

export function serializeMarkdownFile(frontMatter, markdownBody) {
  const orderedFrontMatter = orderFrontMatter(frontMatter);
  const yamlText = yaml.dump(orderedFrontMatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }).trimEnd();

  const body = canonicalizeMarkdown(markdownBody || '');
  return `---\n${yamlText}\n---\n\n${body}`;
}

export function orderFrontMatter(frontMatter) {
  const ordered = {};
  for (const key of FRONT_MATTER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(frontMatter, key)) {
      ordered[key] = frontMatter[key];
    }
  }

  for (const [key, value] of Object.entries(frontMatter)) {
    if (!Object.prototype.hasOwnProperty.call(ordered, key)) {
      ordered[key] = value;
    }
  }

  return ordered;
}

export function validatePageMetadata(filePageId, frontMatter) {
  if (!frontMatter || typeof frontMatter !== 'object') {
    throw new Error('Missing front matter');
  }

  if (frontMatter.schema !== SCHEMA_VERSION) {
    throw new Error(`Unsupported schema: ${frontMatter.schema || '<missing>'}`);
  }

  if (String(frontMatter.page_id || '') !== String(filePageId)) {
    throw new Error(
      `Filename/front matter page ID mismatch: file=${filePageId}, page_id=${frontMatter.page_id}`,
    );
  }
}
