import { visit } from 'unist-util-visit';

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toString(node) {
  if (node.type === 'text') return node.value;
  if (node.children) return node.children.map(toString).join('');
  return '';
}

function slugify(s) {
  return s.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const PILL_NAMES = ['type', 'required', 'since', 'default', 'deprecated'];

function pillToHtml(name, content) {
  switch (name) {
    case 'type': return `<span class="pill type">${content}</span>`;
    case 'required': return '<span class="pill required">required</span>';
    case 'since': return `<span class="pill since">${content}</span>`;
    case 'default': return `<span class="pill default"><span class="pill-label">default:</span><span class="pill-val">${content}</span></span>`;
    case 'deprecated': return `<span class="pill deprecated">${content}</span>`;
    default: return '';
  }
}

function buildTerminalHtml(content) {
  const lines = content.split('\n');
  const spans = lines.map(line => {
    if (line.startsWith('# ')) {
      return `<span class="term-line comment">${escapeHtml(line.slice(2))}</span>`;
    } else if (line.startsWith('> ')) {
      return `<span class="term-line out">${escapeHtml(line.slice(2))}</span>`;
    } else {
      return `<span class="term-line">${escapeHtml(line)}</span>`;
    }
  }).join('\n');

  return `<div class="terminal">\n${spans}\n</div>`;
}

function buildCodeBlockHtml(content, lang, title) {
  let html = '<div class="code-block">';
  if (title) html += `\n<span class="code-lang">${escapeHtml(title)}</span>`;
  html += `\n<pre><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(content)}</code></pre>\n</div>`;
  return html;
}

function isFieldHeading(node) {
  if (node.type !== 'heading') return false;
  const meaningful = node.children.filter(c => !(c.type === 'text' && !c.value.trim()));
  if (!meaningful.length) return false;
  if (meaningful[0].type !== 'inlineCode') return false;
  return meaningful.slice(1).every(c => c.type === 'textDirective' && PILL_NAMES.includes(c.name));
}

function processFieldHeadings(tree) {
  const children = tree.children;
  const newChildren = [];
  let i = 0;

  while (i < children.length) {
    if (isFieldHeading(children[i])) {
      const fieldDepth = children[i].depth;
      const fields = [];

      while (i < children.length) {
        if (!isFieldHeading(children[i])) break;

        const heading = children[i];
        const body = [];
        i++;

        while (i < children.length) {
          if (isFieldHeading(children[i])) break;
          if (children[i].type === 'heading' && children[i].depth <= fieldDepth) break;
          body.push(children[i]);
          i++;
        }

        fields.push({ heading, body });
      }

      newChildren.push({ type: 'html', value: '<section class="field-list">' });

      for (const field of fields) {
        const inlineCode = field.heading.children.find(c => c.type === 'inlineCode');
        const name = inlineCode?.value || '';
        const directives = field.heading.children.filter(c => c.type === 'textDirective');
        const pillsHtml = directives.map(d => pillToHtml(d.name, toString(d))).join('');
        const isDeprecated = directives.some(d => d.name === 'deprecated');
        const id = 'field-' + slugify(name);

        const nameHtml = isDeprecated
          ? `<span class="field-name deprecated"><span class="field-key">${escapeHtml(name)}</span></span>`
          : `<span class="field-name">${escapeHtml(name)}</span>`;

        newChildren.push(
          { type: 'html', value: `<section class="field" id="${id}"><div class="field-head">${nameHtml}${pillsHtml}</div><div class="field-body">` },
          ...field.body,
          { type: 'html', value: '</div></section>' },
        );
      }

      newChildren.push({ type: 'html', value: '</section>' });
    } else {
      newChildren.push(children[i]);
      i++;
    }
  }

  tree.children = newChildren;
}

export default function remarkDocs() {
  return (tree) => {
    visit(tree, 'code', (node, index, parent) => {
      if (!parent) return;

      if (node.lang === 'terminal') {
        parent.children[index] = {
          type: 'html',
          value: buildTerminalHtml(node.value),
        };
        return index;
      }

      const titleMatch = node.meta?.match(/title="([^"]+)"/);
      parent.children[index] = {
        type: 'html',
        value: buildCodeBlockHtml(node.value, node.lang || '', titleMatch?.[1] || ''),
      };
      return index;
    });

    visit(tree, 'containerDirective', (node, index, parent) => {
      if (!parent) return;
      const type = node.name;

      if (['note', 'tip', 'warning', 'danger'].includes(type)) {
        const labelChild = node.children.find(c => c.data?.directiveLabel);
        const label = labelChild ? toString(labelChild) : type.toUpperCase();

        node.children = node.children.filter(c => !c.data?.directiveLabel);

        const data = node.data || (node.data = {});
        data.hName = 'div';
        data.hProperties = {
          className: ['admonition', type],
          dataAdmonition: type,
          dataLabel: label,
        };
      }

      if (type === 'steps') {
        const ol = node.children.find(c => c.type === 'list' && c.ordered);
        if (ol) {
          const data = ol.data || (ol.data = {});
          data.hProperties = { ...(data.hProperties || {}), className: ['steps'] };
          parent.children[index] = ol;
          return index;
        }
      }
    });

    processFieldHeadings(tree);

    visit(tree, 'textDirective', (node, index, parent) => {
      if (!parent || !PILL_NAMES.includes(node.name)) return;
      const content = toString(node);
      parent.children[index] = { type: 'html', value: pillToHtml(node.name, content) };
      return index;
    });
  };
}
