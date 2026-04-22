import {defineConfig} from 'astro/config';
import remarkDirective from 'remark-directive';
import remarkDocs from './plugins/remark-docs.mjs';
import rehypeDocs from './plugins/rehype-docs.mjs';

export default defineConfig({
  build: {
    format: `file`,
  },
  markdown: {
    syntaxHighlight: false,
    remarkPlugins: [remarkDirective, remarkDocs],
    rehypePlugins: [rehypeDocs],
  },
});
