/**
 * Sync engine for pull/push workflows.
 */

import {
  getPageById,
  getPageByTitle,
  getPageUrls,
  getUser,
  parsePageUrl,
  resolveShortUrl,
  updatePage,
} from './api.mjs';
import { getDefaultHost, getHostByUrl, getHostConfig } from './config.mjs';
import { markdownToXml, xmlToMarkdown, canonicalizeXml } from './convert.mjs';
import {
  SCHEMA_VERSION,
  computeSha256,
  listTrackedPageIds,
  readPageFile,
  writePageFile,
} from './store.mjs';

function nowIso() {
  return new Date().toISOString();
}

function coerceBoolean(value) {
  return value === true;
}

function localStatusFromFile(pageFile) {
  const localHash = computeSha256(pageFile.body);
  const baselineHash = pageFile.frontMatter.local_md_sha256 || '';
  const changed = localHash !== baselineHash;

  return {
    changed,
    localHash,
    pendingPush: changed || coerceBoolean(pageFile.frontMatter.pending_push),
  };
}

function buildFrontMatter(page, host, markdownBody, extras = {}) {
  const urls = getPageUrls(host, page);
  const remoteXml = page.body?.storage?.value || '';
  const remoteModified = page.version?.when || null;

  return {
    schema: SCHEMA_VERSION,
    page_id: String(page.id),
    host: host.name,
    space_key: page.space?.key || '',
    title: page.title || '',
    remote_version_at_pull: Number(page.version?.number || 0),
    remote_last_modified: remoteModified,
    remote_sha256_at_pull: computeSha256(canonicalizeXml(remoteXml)),
    local_md_sha256: computeSha256(markdownBody),
    dirty: false,
    pending_push: false,
    last_pull_at: nowIso(),
    last_push_at: extras.last_push_at ?? null,
    source_url: extras.source_url || urls.webui,
    permalink_url: urls.permalink,
    guid_url: urls.guid,
    source_format: 'confluence-storage',
  };
}

export async function resolvePageReference(ref, options = {}) {
  const hostNameOverride = options.hostName;

  if (String(ref).startsWith('http')) {
    const host = getHostByUrl(ref);
    const parsed = parsePageUrl(ref);

    if (parsed.type === 'short') {
      const resolved = await resolveShortUrl(ref, host);
      return resolvePageReference(resolved, options);
    }

    if (parsed.type === 'id') {
      const page = await getPageById(host, parsed.pageId);
      return { host, page, sourceUrl: ref };
    }

    if (parsed.type === 'title') {
      const page = await getPageByTitle(host, parsed.spaceKey, parsed.title);
      return { host, page, sourceUrl: ref };
    }

    throw new Error(`Could not resolve URL: ${ref}`);
  }

  const hostName = hostNameOverride || getDefaultHost();
  const host = getHostConfig(hostName);
  const page = await getPageById(host, ref);
  const sourceUrl = `${host.url}/pages/viewpage.action?pageId=${page.id}`;
  return { host, page, sourceUrl };
}

export async function pullOne(ref, options = {}) {
  const cwd = options.cwd || process.cwd();
  const force = options.force === true;
  const resolved = await resolvePageReference(ref, options);
  const { host, page, sourceUrl } = resolved;
  const pageId = String(page.id);

  const existing = readPageFile(cwd, pageId);
  if (existing) {
    const status = localStatusFromFile(existing);
    if (status.pendingPush && !force) {
      throw new Error(
        `Refusing to overwrite local pending changes for page ${pageId}. Push first or rerun with --force.`,
      );
    }
  }

  const userDisplayNameCache = new Map();
  const { markdownBody } = await xmlToMarkdown(page.body?.storage?.value || '', {
    title: page.title || '',
    resolveUserDisplayName: async (userKey) => {
      if (userDisplayNameCache.has(userKey)) {
        return userDisplayNameCache.get(userKey);
      }

      const user = await getUser(host, userKey);
      const displayName = user?.displayName || user?.username || `Unknown User (${userKey})`;
      userDisplayNameCache.set(userKey, displayName);
      return displayName;
    },
  });

  const frontMatter = buildFrontMatter(page, host, markdownBody, {
    source_url: sourceUrl,
    last_push_at: existing?.frontMatter?.last_push_at ?? null,
  });

  const path = writePageFile(cwd, pageId, frontMatter, markdownBody);

  return {
    pageId,
    host: host.name,
    path,
    title: page.title,
    version: page.version?.number || 0,
    status: existing ? 'updated' : 'created',
  };
}

export async function pullAllTracked(options = {}) {
  const cwd = options.cwd || process.cwd();
  const trackedIds = listTrackedPageIds(cwd);

  const result = {
    scanned: trackedIds.length,
    pulled: [],
    skippedPending: [],
    skippedCurrent: [],
    errors: [],
  };

  for (const pageId of trackedIds) {
    try {
      const local = readPageFile(cwd, pageId);
      if (!local) {
        continue;
      }

      const status = localStatusFromFile(local);
      if (status.pendingPush) {
        result.skippedPending.push({
          pageId,
          reason: 'local pending changes',
        });
        continue;
      }

      const host = getHostConfig(local.frontMatter.host || undefined);
      const remote = await getPageById(host, pageId);
      const remoteVersion = Number(remote.version?.number || 0);
      const baselineVersion = Number(local.frontMatter.remote_version_at_pull || 0);

      if (remoteVersion <= baselineVersion) {
        result.skippedCurrent.push({
          pageId,
          version: remoteVersion,
        });
        continue;
      }

      const pulled = await pullOne(pageId, {
        ...options,
        hostName: host.name,
        force: true,
      });
      result.pulled.push(pulled);
    } catch (error) {
      result.errors.push({
        pageId,
        error: error.message,
      });
    }
  }

  return result;
}

export async function pushPending(options = {}) {
  const cwd = options.cwd || process.cwd();
  const trackedIds = listTrackedPageIds(cwd);

  const result = {
    scanned: trackedIds.length,
    pushed: [],
    skippedClean: [],
    conflicts: [],
    errors: [],
  };

  for (const pageId of trackedIds) {
    try {
      const local = readPageFile(cwd, pageId);
      if (!local) {
        continue;
      }

      const localStatus = localStatusFromFile(local);
      if (!localStatus.pendingPush) {
        result.skippedClean.push({ pageId });
        continue;
      }

      const host = getHostConfig(local.frontMatter.host || undefined);
      const remote = await getPageById(host, pageId);
      const remoteVersion = Number(remote.version?.number || 0);
      const baselineVersion = Number(local.frontMatter.remote_version_at_pull || 0);

      if (remoteVersion > baselineVersion) {
        result.conflicts.push({
          pageId,
          localBaselineVersion: baselineVersion,
          remoteVersion,
          reason: 'Remote version advanced. Pull first.',
        });
        continue;
      }

      const { xml } = markdownToXml(local.text);
      const updated = await updatePage(
        host,
        pageId,
        local.frontMatter.title || remote.title,
        local.frontMatter.space_key || remote.space?.key,
        xml,
        remoteVersion,
      );

      const updatedVersion = Number(updated?.version?.number || remoteVersion + 1);
      const updatedFrontMatter = {
        ...local.frontMatter,
        title: updated?.title || local.frontMatter.title,
        space_key: updated?.space?.key || local.frontMatter.space_key,
        remote_version_at_pull: updatedVersion,
        remote_last_modified: updated?.version?.when || nowIso(),
        remote_sha256_at_pull: computeSha256(canonicalizeXml(xml)),
        local_md_sha256: localStatus.localHash,
        dirty: false,
        pending_push: false,
        last_push_at: nowIso(),
      };

      writePageFile(cwd, pageId, updatedFrontMatter, local.body);

      result.pushed.push({
        pageId,
        version: updatedVersion,
      });
    } catch (error) {
      result.errors.push({
        pageId,
        error: error.message,
      });
    }
  }

  return result;
}
