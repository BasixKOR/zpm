import {defineConfig} from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import remarkDirective from 'remark-directive';
import remarkAutolinkFields from './plugins/remark-autolink-fields.mjs';
import remarkDocs from './plugins/remark-docs.mjs';
import rehypeDocs from './plugins/rehype-docs.mjs';

export default defineConfig({
  adapter: node({mode: `standalone`}),
  integrations: [react()],
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
