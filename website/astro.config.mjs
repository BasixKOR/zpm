import react                from '@astrojs/react';
import sitemap              from '@astrojs/sitemap';
import tailwindcss          from '@tailwindcss/vite';
import {defineConfig}       from 'astro/config';
import remarkDirective      from 'remark-directive';

import rehypeDocs           from './plugins/rehype-docs.mjs';
import remarkAutolinkFields from './plugins/remark-autolink-fields.mjs';
import remarkDocs           from './plugins/remark-docs.mjs';

export default defineConfig({
  site: `https://v6.yarnpkg.com`,
  integrations: [react(), sitemap({filter: page => !page.includes(`/presentation/`)})],
  build: {
    format: `file`,
  },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: [
        `prettier/standalone`,
        `prettier/plugins/babel`,
        `prettier/plugins/estree`,
        `prettier/plugins/typescript`,
        `prettier/plugins/postcss`,
        `prettier/plugins/html`,
        `prettier/plugins/markdown`,
        `prettier/plugins/yaml`,
      ],
    },
  },
  markdown: {
    syntaxHighlight: false,
    remarkPlugins: [remarkDirective, remarkDocs, remarkAutolinkFields],
    rehypePlugins: [rehypeDocs],
  },
});
