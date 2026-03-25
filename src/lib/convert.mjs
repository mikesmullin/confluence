/**
 * Deterministic XML <-> Markdown conversion helpers.
 *
 * Strategy:
 * - Render common Confluence storage XML structures into readable markdown.
 * - Keep unsupported structures as confluence-xml fenced blocks.
 */

import { canonicalizeMarkdown, canonicalizeText, parseMarkdownFile } from './store.mjs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const OPAQUE_FENCE_LANG = 'confluence-xml';

const MACRO_TO_ADMONITION = {
  note: 'NOTE',
  tip: 'TIP',
  info: 'IMPORTANT',
  warn: 'WARNING',
  warning: 'WARNING',
};

const ADMONITION_TO_MACRO = {
  NOTE: 'note',
  TIP: 'tip',
  IMPORTANT: 'info',
  WARNING: 'warn',
  CAUTION: 'note',
};

export function canonicalizeXml(xml) {
  // Keep XML payload structurally intact while normalizing transport-level whitespace.
  const normalized = canonicalizeText(xml || '').trim();
  return normalized ? `${normalized}\n` : '';
}

export async function xmlToMarkdown(xml, metadata = {}) {
  const canonicalXml = canonicalizeXml(xml);

  const parser = new DOMParser();
  const wrapped = `<root xmlns:ac="urn:ac" xmlns:ri="urn:ri">${canonicalXml}</root>`;
  const doc = parser.parseFromString(wrapped, 'application/xml');

  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    return {
      markdownBody: renderOpaque(canonicalXml),
    };
  }

  const root = doc.documentElement;
  const parts = [];

  if (metadata?.title) {
    parts.push(`# ${metadata.title}`);
  }

  for (const node of getChildNodes(root)) {
    const rendered = await renderBlockNode(node, metadata);
    if (rendered) {
      parts.push(rendered.trimEnd());
    }
  }

  const joined = parts.filter(Boolean).join('\n\n');
  const markdownBody = joined.trim() ? `${joined}\n` : '';

  return {
    markdownBody: canonicalizeMarkdown(markdownBody),
  };
}

export function markdownToXml(markdownText) {
  let body = markdownText;
  let frontMatter = null;

  if (String(markdownText).startsWith('---\n')) {
    const parsed = parseMarkdownFile(markdownText);
    body = parsed.body;
    frontMatter = parsed.frontMatter;
  }

  const xmlBlocks = extractOpaqueXmlBlocks(body);
  if (xmlBlocks.length > 0) {
    return {
      xml: canonicalizeXml(xmlBlocks.join('\n')),
      frontMatter,
    };
  }

  const fallbackXml = markdownToStorageXml(body);
  return {
    xml: canonicalizeXml(fallbackXml),
    frontMatter,
  };
}

function extractOpaqueXmlBlocks(markdownBody) {
  const re = /^```confluence-xml\n([\s\S]*?)\n```\s*$/gm;
  const blocks = [];
  let match;

  while ((match = re.exec(markdownBody)) !== null) {
    blocks.push(match[1]);
  }

  return blocks;
}

function renderOpaque(xml) {
  const lines = [];
  lines.push(`\`\`\`${OPAQUE_FENCE_LANG}`);
  lines.push(canonicalizeXml(xml).trimEnd());
  lines.push('```');
  lines.push('');
  return canonicalizeMarkdown(lines.join('\n'));
}

async function renderBlockNode(node, metadata) {
  if (!node) {
    return '';
  }

  if (node.nodeType === 3) {
    const text = collapseWhitespace(node.nodeValue || '');
    return text;
  }

  if (node.nodeType !== 1) {
    return '';
  }

  const tag = node.localName || node.nodeName;
  const prefix = node.prefix || '';

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    const text = await renderInlineChildren(node, metadata);
    return text ? `${'#'.repeat(level)} ${text}` : '';
  }

  if (tag === 'p') {
    return renderParagraph(node, metadata);
  }

  if (tag === 'hr') {
    return '---';
  }

  if (tag === 'ul' || tag === 'ol') {
    return renderList(node, metadata);
  }

  if (tag === 'table') {
    return renderTable(node, metadata);
  }

  if (tag === 'div') {
    return renderDivAsParagraphs(node, metadata);
  }

  if (prefix === 'ac' && tag === 'structured-macro') {
    const macroRendered = await renderStructuredMacro(node, metadata);
    if (macroRendered) {
      return macroRendered;
    }
  }

  return renderOpaque(new XMLSerializer().serializeToString(node));
}

async function renderParagraph(node, metadata) {
  const text = await renderInlineChildren(node, metadata);
  const normalized = text.replace(/\]\(([^)]+)\)\s+'s\b/g, ']($1)\'s').trim();

  // Canonicalize empty paragraph separators away instead of emitting standalone <br> lines.
  if (!normalized || /^<br>(?:<br>)*$/.test(normalized)) {
    return '';
  }

  return normalized;
}

async function renderDivAsParagraphs(node, metadata) {
  const lines = [];
  for (const child of getChildNodes(node)) {
    const rendered = await renderBlockNode(child, metadata);
    if (rendered) {
      lines.push(rendered);
    }
  }
  return lines.join('\n\n');
}

async function renderList(node, metadata, depth = 0) {
  const isOrdered = (node.localName || node.nodeName) === 'ol';
  const items = [];
  let index = 1;

  for (const child of getChildNodes(node)) {
    if (child.nodeType !== 1 || (child.localName || child.nodeName) !== 'li') {
      continue;
    }

    const content = await renderInlineChildren(child, metadata);
    const marker = isOrdered ? `${index}.` : '-';
    const indent = '  '.repeat(depth);
    items.push(`${indent}${marker} ${content}`.trimEnd());
    index += 1;
  }

  return items.join('\n');
}

async function renderTable(tableNode, metadata) {
  const rows = [];
  for (const tr of findChildElementsDeep(tableNode, 'tr')) {
    const cells = [];
    for (const cell of getChildNodes(tr)) {
      if (cell.nodeType !== 1) {
        continue;
      }
      const cellTag = cell.localName || cell.nodeName;
      if (cellTag !== 'th' && cellTag !== 'td') {
        continue;
      }
      const text = await renderTableCell(cell, metadata);
      cells.push(text);
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) {
    return '';
  }

  const header = rows[0];
  const colCount = header.length;
  const divider = Array.from({ length: colCount }, () => '---');
  const bodyRows = rows.slice(1).map((row) => normalizeRow(row, colCount));

  const lines = [];
  lines.push(`| ${normalizeRow(header, colCount).join(' | ')} |`);
  lines.push(`| ${divider.join(' | ')} |`);
  for (const row of bodyRows) {
    lines.push(`| ${row.join(' | ')} |`);
  }

  return lines.join('\n');
}

function normalizeRow(row, colCount) {
  const normalized = row.slice(0, colCount);
  while (normalized.length < colCount) {
    normalized.push('');
  }
  return normalized.map((v) => v.replace(/\|/g, '\\|'));
}

async function renderTableCell(cell, metadata) {
  const parts = [];

  for (const child of getChildNodes(cell)) {
    if (child.nodeType === 3) {
      const t = collapseWhitespace(child.nodeValue || '');
      if (t) {
        parts.push(t);
      }
      continue;
    }

    if (child.nodeType !== 1) {
      continue;
    }

    const tag = child.localName || child.nodeName;
    if (tag === 'p') {
      const t = await renderInlineChildren(child, metadata);
      if (t) {
        parts.push(t);
      }
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      const lines = [];
      for (const li of getChildNodes(child)) {
        if (li.nodeType === 1 && (li.localName || li.nodeName) === 'li') {
          const t = await renderInlineChildren(li, metadata);
          if (t) {
            lines.push(t);
          }
        }
      }
      if (lines.length > 0) {
        parts.push(lines.join('<br>'));
      }
      continue;
    }

    if (tag === 'div') {
      const divText = await renderTableCell(child, metadata);
      if (divText) {
        parts.push(divText);
      }
      continue;
    }

    const t = await renderInlineNode(child, metadata);
    if (t) {
      parts.push(t);
    }
  }

  const rendered = parts.join('<br>').replace(/(?:<br>){3,}/g, '<br><br>').trim();
  if (!rendered || rendered === '<br>' || rendered === '<br><br>') {
    return '';
  }
  return rendered;
}

async function renderInlineChildren(node, metadata) {
  const parts = [];
  for (const child of getChildNodes(node)) {
    const text = await renderInlineNode(child, metadata);
    if (text) {
      parts.push(text);
    }
  }
  let out = collapseWhitespace(parts.join('')).replace(/\s*<br>\s*/g, '<br>').trim();

  // Keep markdown emphasis tokens readable when adjacent nodes had no literal separator.
  out = out.replace(/(\*\*[^*]+\*\*)(?=\[|[A-Za-z0-9])/g, '$1 ');
  out = out.replace(/(\*[^*]+\*)(?=\[|[A-Za-z0-9])/g, '$1 ');

  return out;
}

async function renderInlineNode(node, metadata) {
  if (node.nodeType === 3) {
    return normalizeText(node.nodeValue || '');
  }

  if (node.nodeType !== 1) {
    return '';
  }

  const tag = node.localName || node.nodeName;
  const prefix = node.prefix || '';

  if (tag === 'br') {
    return '<br>';
  }

  if (tag === 'time') {
    return node.getAttribute('datetime') || '';
  }

  if (tag === 'a') {
    const href = node.getAttribute('href') || '';
    const text = await renderInlineChildren(node, metadata);
    return href ? `[${text || href}](${href})` : text;
  }

  if (tag === 'strong' || tag === 'b') {
    return `**${await renderInlineChildren(node, metadata)}**`;
  }

  if (tag === 'em' || tag === 'i') {
    return `*${await renderInlineChildren(node, metadata)}*`;
  }

  if (tag === 'code') {
    return `\`${await renderInlineChildren(node, metadata)}\``;
  }

  if (prefix === 'ac' && tag === 'link') {
    return renderConfluenceLink(node, metadata);
  }

  if (tag === 'plain-text-link-body') {
    return decodeCdataText(node.textContent || '');
  }

  if (tag === 'p' || tag === 'div') {
    return await renderInlineChildren(node, metadata);
  }

  return await renderInlineChildren(node, metadata);
}

async function renderConfluenceLink(linkNode, metadata) {
  const userNode = findFirstElement(linkNode, 'user', 'ri');
  if (userNode) {
    const userKey = userNode.getAttribute('ri:userkey') || userNode.getAttribute('userkey') || '';
    if (!userKey) {
      return '';
    }
    const displayName = await resolveUserDisplayName(userKey, metadata);
    const label = displayName ? `@${displayName}` : '@Unknown User';
    return `[${label}](/ri:user?ri:userkey=${encodeURIComponent(userKey)})`;
  }

  const pageNode = findFirstElement(linkNode, 'page', 'ri');
  if (pageNode) {
    const spaceKey = pageNode.getAttribute('ri:space-key') || pageNode.getAttribute('space-key') || '';
    const title = pageNode.getAttribute('ri:content-title') || pageNode.getAttribute('content-title') || '';
    const plainTextNode = findFirstElement(linkNode, 'plain-text-link-body', 'ac');
    const text = (plainTextNode ? decodeCdataText(plainTextNode.textContent || '') : title) || title;
    const encodedSpace = encodeURIComponent(spaceKey).replace(/\(/g, '%28').replace(/\)/g, '%29');
    const encodedTitle = encodeURIComponent(title).replace(/\(/g, '%28').replace(/\)/g, '%29');
    const href = `/ri:page?ri:space-key=${encodedSpace}&ri:content-title=${encodedTitle}`;
    return `[${text}](${href})`;
  }

  const fallback = await renderInlineChildren(linkNode, metadata);
  return fallback;
}

async function resolveUserDisplayName(userKey, metadata) {
  const resolver = metadata?.resolveUserDisplayName;
  if (typeof resolver !== 'function') {
    return null;
  }

  try {
    return await resolver(userKey);
  } catch {
    return null;
  }
}

function findFirstElement(node, localName, prefix) {
  for (const child of getChildNodes(node)) {
    if (child.nodeType !== 1) {
      continue;
    }
    const childLocalName = child.localName || child.nodeName;
    const childPrefix = child.prefix || '';
    if (childLocalName === localName && childPrefix === prefix) {
      return child;
    }
    const nested = findFirstElement(child, localName, prefix);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function findChildElementsDeep(node, localName) {
  const found = [];
  const walk = (current) => {
    for (const child of getChildNodes(current)) {
      if (child.nodeType !== 1) {
        continue;
      }
      if ((child.localName || child.nodeName) === localName) {
        found.push(child);
      }
      walk(child);
    }
  };
  walk(node);
  return found;
}

function decodeCdataText(text) {
  return String(text).replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim();
}

function normalizeText(value) {
  return String(value).replace(/\u00a0/g, ' ');
}

function collapseWhitespace(value) {
  return normalizeText(value).replace(/[ \t\n\r]+/g, ' ').trim();
}

function getChildNodes(node) {
  const nodes = [];
  const list = node?.childNodes;
  if (!list || typeof list.length !== 'number') {
    return nodes;
  }

  for (let i = 0; i < list.length; i += 1) {
    nodes.push(list.item(i));
  }

  return nodes;
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownParagraphsToStorageXml(markdownBody) {
  return markdownToStorageXml(markdownBody);
}

function markdownToStorageXml(markdownBody) {
  let lines = canonicalizeMarkdown(markdownBody)
    .trimEnd()
    .split('\n');

  // Magic title heading: first-line H1 is file title metadata and not body content.
  if (lines.length > 0 && /^#\s+/.test(lines[0])) {
    lines = lines.slice(1);
    if (lines.length > 0 && !lines[0].trim()) {
      lines = lines.slice(1);
    }
  }

  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i] || '';
    const line = raw.trimEnd();

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdownToXml(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push('<hr />');
      i += 1;
      continue;
    }

    if (/^>\s*\[![A-Za-z]+\]\s*$/.test(line.trim())) {
      const { xml, nextIndex } = parseMarkdownAdmonition(lines, i);
      if (xml) {
        blocks.push(xml);
        i = nextIndex;
        continue;
      }
    }

    if (line.startsWith('|') && i + 1 < lines.length && /^\|\s*-+/.test(lines[i + 1])) {
      const { xml, nextIndex } = parseMarkdownTable(lines, i);
      blocks.push(xml);
      i = nextIndex;
      continue;
    }

    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const { xml, nextIndex } = parseMarkdownList(lines, i);
      blocks.push(xml);
      i = nextIndex;
      continue;
    }

    const paraLines = [];
    while (i < lines.length) {
      const t = (lines[i] || '').trimEnd();
      if (!t.trim()) {
        break;
      }
      if (/^(#{1,6})\s+/.test(t)) {
        break;
      }
      if ((t.startsWith('|') && i + 1 < lines.length && /^\|\s*-+/.test(lines[i + 1])) || /^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t)) {
        break;
      }
      paraLines.push(t);
      i += 1;
    }

    const para = paraLines.join(' ').trim();
    if (para) {
      blocks.push(`<p>${renderInlineMarkdownToXml(para)}</p>`);
    }

    if (i < lines.length && !lines[i].trim()) {
      i += 1;
    }
  }

  if (blocks.length === 0) {
    return '<p></p>';
  }

  return blocks.join('\n');
}

function parseMarkdownAdmonition(lines, startIndex) {
  const header = (lines[startIndex] || '').trim();
  const match = header.match(/^>\s*\[!([A-Za-z]+)\]\s*$/);
  if (!match) {
    return { xml: '', nextIndex: startIndex + 1 };
  }

  const token = match[1].toUpperCase();
  const macroName = ADMONITION_TO_MACRO[token] || null;
  if (!macroName) {
    return { xml: '', nextIndex: startIndex + 1 };
  }

  const bodyLines = [];
  let i = startIndex + 1;
  while (i < lines.length) {
    const current = lines[i] || '';
    if (!current.trim()) {
      break;
    }

    const quoted = current.match(/^>\s?(.*)$/);
    if (quoted) {
      bodyLines.push(quoted[1]);
      i += 1;
      continue;
    }

    // Allow one unquoted continuation line for permissive parsing.
    bodyLines.push(current.trim());
    i += 1;
  }

  const richBody = renderAdmonitionBodyToXml(bodyLines);
  const xml = `<ac:structured-macro ac:name="${macroName}" ac:schema-version="1"><ac:rich-text-body>${richBody}</ac:rich-text-body></ac:structured-macro>`;
  return { xml, nextIndex: i };
}

function renderAdmonitionBodyToXml(lines) {
  const filtered = lines.map((line) => line.trim()).filter(Boolean);
  if (filtered.length === 0) {
    return '<p><br /></p>';
  }
  return filtered.map((line) => `<p>${renderInlineMarkdownToXml(line)}</p>`).join('');
}

function parseMarkdownList(lines, startIndex) {
  const listItems = [];
  let i = startIndex;
  const ordered = /^\d+\.\s+/.test((lines[startIndex] || '').trim());
  const markerRe = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;

  while (i < lines.length) {
    const line = (lines[i] || '').trimEnd();
    if (!line.trim()) {
      break;
    }
    if (!markerRe.test(line.trim())) {
      break;
    }
    const itemText = line.trim().replace(markerRe, '');
    listItems.push(`<li>${renderInlineMarkdownToXml(itemText)}</li>`);
    i += 1;
  }

  const tag = ordered ? 'ol' : 'ul';
  return {
    xml: `<${tag}>${listItems.join('')}</${tag}>`,
    nextIndex: i,
  };
}

function parseMarkdownTable(lines, startIndex) {
  const rows = [];
  let i = startIndex;

  const parseRow = (rowLine) => rowLine
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

  const headerCells = parseRow(lines[i]);
  rows.push({ type: 'header', cells: headerCells });
  i += 2; // skip divider

  while (i < lines.length) {
    const rowLine = (lines[i] || '').trimEnd();
    if (!rowLine.trim() || !rowLine.trim().startsWith('|')) {
      break;
    }
    rows.push({ type: 'body', cells: parseRow(rowLine) });
    i += 1;
  }

  const colCount = rows[0]?.cells?.length || 0;
  const colgroup = `<colgroup>${Array.from({ length: colCount }, () => '<col />').join('')}</colgroup>`;

  const trXml = rows.map((row) => {
    if (row.type === 'header') {
      const th = row.cells.map((cell) => `<th scope="col">${renderTableCellMarkdownToXml(cell)}</th>`).join('');
      return `<tr>${th}</tr>`;
    }
    const normalized = normalizeRow(row.cells, colCount);
    const td = normalized.map((cell) => `<td>${renderTableCellMarkdownToXml(cell)}</td>`).join('');
    return `<tr>${td}</tr>`;
  }).join('');

  return {
    xml: `<table class="wrapped">${colgroup}<tbody>${trXml}</tbody></table>`,
    nextIndex: i,
  };
}

function renderTableCellMarkdownToXml(cellText) {
  const text = String(cellText || '').trim();
  if (!text) {
    return '<div class="content-wrapper"><p><br /></p></div>';
  }

  const segments = text.split(/<br\s*\/?\s*>/i).map((s) => s.trim()).filter(Boolean);
  if (segments.length <= 1) {
    return renderInlineMarkdownToXml(text);
  }

  const paragraphs = segments
    .map((segment) => `<p>${renderInlineMarkdownToXml(segment)}</p>`)
    .join('');
  return `<div class="content-wrapper">${paragraphs}</div>`;
}

function renderInlineMarkdownToXml(input) {
  let text = String(input || '');
  text = text.replace(/<br\s*\/?\s*>/gi, '[[BR]]');

  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => markdownLinkToXml(label, href));
  text = text.replace(/\*\*([^*]+)\*\*/g, (_, inner) => `<strong>${escapeXml(inner)}</strong>`);
  text = text.replace(/\*([^*]+)\*/g, (_, inner) => `<em>${escapeXml(inner)}</em>`);
  text = text.replace(/`([^`]+)`/g, (_, inner) => `<code>${escapeXml(inner)}</code>`);

  // Escape any remaining raw text, but preserve XML tags already injected above.
  text = escapeLooseTextWithTags(text);
  text = text.replace(/\[\[BR\]\]/g, '<br />');
  return text;
}

async function renderStructuredMacro(node, metadata) {
  const macroName = (node.getAttribute('ac:name') || '').toLowerCase();
  const admonitionType = MACRO_TO_ADMONITION[macroName] || null;
  if (!admonitionType) {
    return '';
  }

  const richBody = findFirstElement(node, 'rich-text-body', 'ac');
  const bodyParts = [];
  if (richBody) {
    for (const child of getChildNodes(richBody)) {
      const rendered = await renderBlockNode(child, metadata);
      if (rendered) {
        bodyParts.push(rendered.trim());
      }
    }
  }

  const lines = [`> [!${admonitionType}]`];
  if (bodyParts.length === 0) {
    lines.push('>');
  } else {
    const body = bodyParts.join('\n\n');
    for (const bodyLine of body.split('\n')) {
      lines.push(bodyLine.trim() ? `> ${bodyLine}` : '>');
    }
  }

  return lines.join('\n');
}

function markdownLinkToXml(label, href) {
  const url = String(href || '').trim();
  const text = String(label || '').trim();

  if (url.startsWith('/ri:user?')) {
    const params = new URLSearchParams(url.slice('/ri:user?'.length));
    const key = params.get('ri:userkey') || '';
    if (key) {
      return `<ac:link><ri:user ri:userkey="${escapeXml(key)}" /></ac:link>`;
    }
  }

  if (url.startsWith('/ri:page?')) {
    const params = new URLSearchParams(url.slice('/ri:page?'.length));
    const spaceKey = params.get('ri:space-key') || '';
    const title = params.get('ri:content-title') || '';
    const defaultText = title || '';
    const normalizedText = text.replace(/^@/, '');
    if (spaceKey || title) {
      if (normalizedText && normalizedText !== defaultText) {
        return `<ac:link><ri:page ri:space-key="${escapeXml(spaceKey)}" ri:content-title="${escapeXml(title)}" /><ac:plain-text-link-body><![CDATA[${text}]]></ac:plain-text-link-body></ac:link>`;
      }
      return `<ac:link><ri:page ri:space-key="${escapeXml(spaceKey)}" ri:content-title="${escapeXml(title)}" /></ac:link>`;
    }
  }

  return `<a href="${escapeXml(url)}">${escapeXml(text || url)}</a>`;
}

function escapeLooseTextWithTags(text) {
  const tokens = [];
  const placeholder = (idx) => `__XMLTOKEN_${idx}__`;
  let out = String(text || '');

  out = out.replace(/<[^>]+>/g, (tag) => {
    const idx = tokens.length;
    tokens.push(tag);
    return placeholder(idx);
  });

  out = escapeXml(out);

  for (let i = 0; i < tokens.length; i += 1) {
    const encoded = escapeXml(placeholder(i));
    out = out.replaceAll(encoded, tokens[i]);
  }

  return out;
}

