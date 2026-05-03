import {defineConfig} from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import remarkDirective from 'remark-directive';
import remarkAutolinkFields from './plugins/remark-autolink-fields.mjs';
import remarkDocs from './plugins/remark-docs.mjs';
import rehypeDocs from './plugins/rehype-docs.mjs';

export default defineConfig({
  integrations: [react()],
  build: {
    format: `file`,
  },
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    syntaxHighlight: false,
    remarkPlugins: [remarkDirective, remarkDocs, remarkAutolinkFields],
    rehypePlugins: [rehypeDocs],
  },
});
