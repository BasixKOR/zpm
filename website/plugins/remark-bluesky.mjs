import {visit} from 'unist-util-visit';

async function fetchBskyPost(atUri) {
  const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(atUri)}&depth=0`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch BlueSky post ${atUri}: ${res.status}`);
  const data = await res.json();
  return data.thread.post;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, `&amp;`)
    .replace(/</g, `&lt;`)
    .replace(/>/g, `&gt;`)
    .replace(/"/g, `&quot;`);
}

function applyFacets(text, facets) {
  if (!facets || !facets.length) return escapeHtml(text);

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(text);

  const sorted = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart);
  const segments = [];
  let cursor = 0;

  for (const facet of sorted) {
    const {byteStart, byteEnd} = facet.index;
    if (byteStart > cursor)
      segments.push(escapeHtml(decoder.decode(bytes.slice(cursor, byteStart))));

    const segText = decoder.decode(bytes.slice(byteStart, byteEnd));
    const feature = facet.features[0];

    if (feature.$type === `app.bsky.richtext.facet#link`)
      segments.push(`<a href="${escapeHtml(feature.uri)}" target="_blank" rel="noopener noreferrer">${escapeHtml(segText)}</a>`);
    else if (feature.$type === `app.bsky.richtext.facet#mention`)
      segments.push(`<a href="https://bsky.app/profile/${escapeHtml(feature.did)}" target="_blank" rel="noopener noreferrer">${escapeHtml(segText)}</a>`);
    else if (feature.$type === `app.bsky.richtext.facet#tag`)
      segments.push(`<a href="https://bsky.app/hashtag/${encodeURIComponent(feature.tag)}" target="_blank" rel="noopener noreferrer">${escapeHtml(segText)}</a>`);
    else
      segments.push(escapeHtml(segText));

    cursor = byteEnd;
  }

  if (cursor < bytes.length)
    segments.push(escapeHtml(decoder.decode(bytes.slice(cursor))));

  return segments.join(``);
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString(`en-US`, {
    month: `short`,
    day: `numeric`,
    year: `numeric`,
  });
}

function renderEmbed(post) {
  const {author, record, likeCount, uri} = post;
  const rkey = uri.split(`/`).pop();
  const postUrl = `https://bsky.app/profile/${author.handle}/post/${rkey}`;
  const profileUrl = `https://bsky.app/profile/${author.handle}`;
  const richText = applyFacets(record.text, record.facets);

  const butterfly = `<svg class="bsky-logo-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Bluesky</title><path d="M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026" fill="currentColor"/></svg>`;
  const heart = `<svg class="bsky-heart-icon" viewBox="0 0 24 24"><path d="M14 20.408c-.492.308-.903.546-1.192.709-.153.086-.308.17-.463.252h-.002a.75.75 0 0 1-.686 0 16.709 16.709 0 0 1-.465-.252 31.147 31.147 0 0 1-4.803-3.34C3.8 15.572 1 12.331 1 8.513 1 5.052 3.829 2.5 6.736 2.5 9.03 2.5 10.881 3.726 12 5.605 13.12 3.726 14.97 2.5 17.264 2.5 20.17 2.5 23 5.052 23 8.514c0 3.818-2.801 7.06-5.389 9.262A31.146 31.146 0 0 1 14 20.408Z" fill="currentColor"/></svg>`;

  return [
    `<div class="bsky-embed">`,
    `  <div class="bsky-content">`,
    `    <div class="bsky-header">`,
    `      <a href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer"><img class="bsky-avatar" src="${escapeHtml(author.avatar)}" alt="" loading="lazy" /></a>`,
    `      <div class="bsky-author-info">`,
    `        <a class="bsky-name" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(author.displayName)}</a>`,
    `        <span class="bsky-handle">@${escapeHtml(author.handle)}</span>`,
    `      </div>`,
    `      <a class="bsky-logo" href="${escapeHtml(postUrl)}" target="_blank" rel="noopener noreferrer" aria-label="View on Bluesky">${butterfly}</a>`,
    `    </div>`,
    `    <div class="bsky-text">${richText}</div>`,
    `    <div class="bsky-footer">`,
    `      <a class="bsky-date" href="${escapeHtml(postUrl)}" target="_blank" rel="noopener noreferrer">${formatDate(record.createdAt)}</a>`,
    likeCount > 0 ? `    <span class="bsky-likes">${heart}${likeCount}</span>` : ``,
    `    </div>`,
    `  </div>`,
    `</div>`,
  ].filter(Boolean).join(`\n`);
}

export default function remarkBluesky() {
  return async tree => {
    const nodes = [];

    visit(tree, `html`, (node, index, parent) => {
      if (!parent) return;
      const match = node.value.match(/data-bluesky-uri="(at:\/\/[^"]+)"/);
      if (!match) return;
      nodes.push({node, index, parent, atUri: match[1]});
    });

    if (!nodes.length) return;

    await Promise.all(nodes.map(async ({node, index, parent, atUri}) => {
      const post = await fetchBskyPost(atUri);
      parent.children[index] = {
        type: `html`,
        value: renderEmbed(post),
      };
    }));
  };
}
