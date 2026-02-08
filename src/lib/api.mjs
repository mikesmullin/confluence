/**
 * Confluence REST API client
 * Handles HTTP requests to Confluence with PAT authentication
 */

import { getHostConfig, getHostByUrl } from './config.mjs';

/**
 * Make an authenticated request to Confluence API
 */
async function request(host, method, endpoint, body = null) {
  const url = `${host.url}${host.api}${endpoint}`;

  const headers = {
    'Authorization': `Bearer ${host.token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  console.error(`${method} ${url}`);
  const response = await fetch(url, options);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Confluence API error ${response.status}: ${text}`);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return null;
  }

  return response.json();
}

/**
 * GET request helper
 */
export async function get(host, endpoint) {
  return request(host, 'GET', endpoint);
}

/**
 * POST request helper
 */
export async function post(host, endpoint, body) {
  return request(host, 'POST', endpoint, body);
}

/**
 * PUT request helper
 */
export async function put(host, endpoint, body) {
  return request(host, 'PUT', endpoint, body);
}

/**
 * Search with CQL
 */
export async function search(hostName, cql, options = {}) {
  const host = getHostConfig(hostName);
  const { limit = 25, start = 0 } = options;
  const params = new URLSearchParams({
    cql,
    limit: String(limit),
    start: String(start),
  });
  return get(host, `/search?${params}`);
}

/**
 * Get page by ID
 */
export async function getPageById(host, pageId) {
  return get(host, `/content/${pageId}?expand=body.storage,version,space`);
}

/**
 * Get page by space key and title
 */
export async function getPageByTitle(host, spaceKey, title) {
  const params = new URLSearchParams({
    spaceKey,
    title,
    expand: 'body.storage,version,space',
  });
  const response = await get(host, `/content?${params}`);
  
  if (response.results && response.results.length > 0) {
    return response.results[0];
  }
  throw new Error(`Page not found: ${spaceKey}/${title}`);
}

/**
 * Update page content
 */
export async function updatePage(host, pageId, title, spaceKey, content, currentVersion) {
  const body = {
    id: pageId,
    type: 'page',
    title,
    space: { key: spaceKey },
    body: {
      storage: {
        value: content,
        representation: 'storage',
      },
    },
    version: { number: currentVersion + 1 },
  };
  return put(host, `/content/${pageId}`, body);
}

/**
 * Resolve user by userkey
 */
export async function getUser(host, userkey) {
  return get(host, `/user?key=${encodeURIComponent(userkey)}`);
}

/**
 * Resolve short URLs (e.g., /x/ tiny URLs)
 */
export async function resolveShortUrl(url, host) {
  const MAX_DEPTH = 3;
  let currentUrl = url;

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    console.error(`Resolving URL (depth ${depth}): ${currentUrl}`);

    const response = await fetch(currentUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${host.token}`,
        'Accept': 'application/json',
      },
      redirect: 'follow',
    });

    const finalUrl = response.url;

    // Handle login redirects with os_destination param
    if (finalUrl.includes('login.action') && finalUrl.includes('os_destination=')) {
      const urlObj = new URL(finalUrl);
      const destination = urlObj.searchParams.get('os_destination');
      if (destination) {
        const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
        currentUrl = `${baseUrl}${decodeURIComponent(destination)}`;
        continue;
      }
    }

    // If URL changed significantly, it resolved
    if (finalUrl !== currentUrl && !finalUrl.includes('login.action')) {
      return finalUrl;
    }

    // Try to extract from response if needed
    if (response.ok) {
      return finalUrl;
    }
  }

  return currentUrl;
}

/**
 * Parse page URL to extract page ID or space/title
 */
export function parsePageUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Pattern: /pages/viewpage.action?pageId=12345
    const pageIdMatch = urlObj.searchParams.get('pageId');
    if (pageIdMatch) {
      return { type: 'id', pageId: pageIdMatch };
    }

    // Pattern: /display/SPACE/Page+Title
    const displayMatch = pathname.match(/\/display\/([^/]+)\/(.+)/);
    if (displayMatch) {
      return {
        type: 'title',
        spaceKey: displayMatch[1],
        title: decodeURIComponent(displayMatch[2].replace(/\+/g, ' ')),
      };
    }

    // Pattern: /spaces/SPACE/pages/12345/Page+Title
    const spacesMatch = pathname.match(/\/spaces\/[^/]+\/pages\/(\d+)/);
    if (spacesMatch) {
      return { type: 'id', pageId: spacesMatch[1] };
    }

    // Pattern: /wiki/spaces/SPACE/pages/12345
    const wikiMatch = pathname.match(/\/wiki\/spaces\/[^/]+\/pages\/(\d+)/);
    if (wikiMatch) {
      return { type: 'id', pageId: wikiMatch[1] };
    }

    // Pattern: /x/XXXXX (short URL)
    if (pathname.startsWith('/x/')) {
      return { type: 'short', url };
    }

    throw new Error(`Could not parse Confluence URL: ${url}`);
  } catch (error) {
    if (error.message.includes('Invalid URL')) {
      // Maybe it's just a page ID
      if (/^\d+$/.test(url)) {
        return { type: 'id', pageId: url };
      }
    }
    throw error;
  }
}
