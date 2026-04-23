import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkDocs from '../../plugins/remark-docs.mjs';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeDocs from '../../plugins/rehype-docs.mjs';
import rehypeStringify from 'rehype-stringify';

const processor = unified()
  .use(remarkParse)
  .use(remarkDirective)
  .use(remarkDocs)
  .use(remarkRehype, {allowDangerousHtml: true})
  .use(rehypeRaw)
  .use(rehypeDocs)
  .use(rehypeStringify);

export async function renderDocsMarkdown(md: string): Promise<string> {
  const result = await processor.process(md);
  return String(result);
}
