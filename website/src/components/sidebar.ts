export type SidebarLink = {
  label: string;
  href: string;
  active?: boolean;
  sub?: boolean;
  mono?: boolean;
  section?: boolean;
};

export type SidebarSubtitle = {
  subtitle: string;
};

export type SidebarItem = SidebarLink | SidebarSubtitle;

export interface SidebarGroup {
  title: string;
  items: SidebarItem[];
}

const metaGlob = import.meta.glob<string>('../docs/**/_meta.{yml,yaml}', { eager: true, query: '?raw', import: 'default' });
const docGlob = import.meta.glob<{ frontmatter: Record<string, any> }>('../docs/**/*.md', { eager: true });

const metaLookup = new Map<string, { label: string; order: number }>();
for (const [filePath, content] of Object.entries(metaGlob)) {
  const relDir = filePath.replace(/^\.\.\/docs\//, '').replace(/\/_meta\.(yml|yaml)$/, '');
  const label = content.match(/^label:\s*(.+)$/m)?.[1]?.trim();
  const order = parseInt(content.match(/^order:\s*(\d+)$/m)?.[1] ?? '99', 10);
  metaLookup.set(relDir, { label: label ?? relDir, order });
}

const slugToDir = new Map<string, string>();
for (const [filePath, mod] of Object.entries(docGlob)) {
  const slug = mod.frontmatter?.slug;
  if (slug) {
    const relPath = filePath.replace(/^\.\.\/docs\//, '');
    const lastSlash = relPath.lastIndexOf('/');
    slugToDir.set(slug, lastSlash >= 0 ? relPath.substring(0, lastSlash) : '.');
  }
}

export function formatLabel(dirName: string): string {
  return dirName.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export function getDirForSlug(slug: string): string | undefined {
  return slugToDir.get(slug);
}

export function getMetaForDir(dir: string): { label: string; order: number } | undefined {
  return metaLookup.get(dir);
}

export function getGroupLabelForSlug(slug: string): string | undefined {
  const dir = slugToDir.get(slug);
  if (!dir) return undefined;
  const meta = metaLookup.get(dir);
  return meta?.label ?? formatLabel(dir.split('/').pop()!);
}
