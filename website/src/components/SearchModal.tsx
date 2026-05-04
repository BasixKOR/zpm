import {liteClient as algoliasearch}                        from 'algoliasearch/lite';
import {useState, useEffect, useRef, useCallback, type JSX} from 'react';

const docsClient = algoliasearch(`STXW7VT1S5`, `ecdfaea128fd901572b14543a2116eee`);
const pkgClient = algoliasearch(`OFCNCOG2CU`, `f54e21fa3a2a0160595bb058179bfb1e`);

type Scope = `all` | `docs` | `pkg` | `cli`;
type ResultKind = `docs` | `pkg` | `cli`;

interface SearchItem {
  kind: ResultKind;
  title: string;
  titleHtml: string;
  crumbs?: Array<string>;
  snippet?: string;
  snippetHtml?: string;
  href: string;
  version?: string;
  downloads?: string;
  downloadsRaw?: number;
  author?: string;
  license?: string;
}

// ── Icons ──

function SearchIcon({size = 16, className}: {size?: number, className?: string}) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5"/>
      <path d="M10.5 10.5 L14 14"/>
    </svg>
  );
}

function CloseIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 3l6 6M9 3l-6 6"/></svg>;
}

function ClockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="7" cy="7" r="5.5"/>
      <path d="M7 4v3.5l2.5 1.5"/>
    </svg>
  );
}

function FlameIcon({color}: {color: string}) {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill={color} className="shrink-0">
      <path d="M6 0C6 0 2 4 2 7.5a4 4 0 0 0 8 0C10 4 6 0 6 0zM6 10.5a2.5 2.5 0 0 1-2.5-2.5c0-1.5 2.5-5 2.5-5s2.5 3.5 2.5 5A2.5 2.5 0 0 1 6 10.5z"/>
    </svg>
  );
}

function NoResultsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="5"/>
      <path d="M11.5 11.5L16 16M5.5 8H10.5"/>
    </svg>
  );
}

const SCOPE_ICONS: Record<string, JSX.Element | null> = {
  all: null,
  docs: <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="1.5" width="8" height="9" rx="0.5"/><path d="M4 4h4M4 6h4M4 8h2.5"/></svg>,
  pkg: <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M6 1.5L10.5 4 6 6.5 1.5 4 6 1.5z"/><path d="M1.5 4v4.5L6 11l4.5-2.5V4M6 6.5V11"/></svg>,
  cli: <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2.5 4l2 2-2 2M6 8h3.5"/></svg>,
};

const KIND_GLYPHS: Record<ResultKind, JSX.Element> = {
  docs: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2.5" y="1.8" width="9" height="10.4" rx="0.7"/><path d="M4.7 4.5h4.6M4.7 6.7h4.6M4.7 8.9h3"/></svg>,
  pkg: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 1.7L12 4.3 7 6.9 2 4.3 7 1.7z"/><path d="M2 4.3v5.4L7 12.3 12 9.7V4.3M7 6.9V12.3"/></svg>,
  cli: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5l2.2 2L3 9M7 9.3h4"/></svg>,
};

const SCOPES: Array<{key: Scope, label: string}> = [
  {key: `all`, label: `All`},
  {key: `docs`, label: `Docs`},
  {key: `pkg`, label: `Packages`},
  {key: `cli`, label: `CLI`},
];

const KIND_LABELS: Record<ResultKind, string> = {
  docs: `Documentation`,
  pkg: `Packages`,
  cli: `CLI`,
};

const SUGGESTED = [
  `yarn install`, `workspace protocol`, `zero-installs`,
  `constraints`, `migration from v1`, `lodash`,
];

// ── Recent searches (localStorage) ──

const RECENTS_KEY = `yarn-search-recents`;

function getRecents(): Array<{term: string, kind: string}> {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function addRecent(term: string, kind: string) {
  const recents = getRecents().filter(r => r.term !== term);
  recents.unshift({term, kind});
  if (recents.length > 5) recents.length = 5;
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  } catch {}
}

// ── Helpers ──

function highlightValue(hit: any, attr: string): string {
  return hit?._highlightResult?.[attr]?.value ?? hit?.[attr] ?? ``;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ``);
}

function getFlameColor(downloadsRaw?: number): string | null {
  if (downloadsRaw == null) return null;
  if (downloadsRaw >= 10_000_000) return `#ef4444`;
  if (downloadsRaw >= 1_000_000) return `#f59e0b`;
  return null;
}

function groupResults(results: Array<SearchItem>, scope: Scope): Array<[ResultKind, Array<SearchItem>]> {
  const filtered = scope === `all` ? results : results.filter(r => r.kind === scope);
  const groups: Array<[ResultKind, Array<SearchItem>]> = [];

  if (scope === `all`) {
    for (const k of [`docs`, `pkg`, `cli`] as Array<ResultKind>) {
      const items = filtered.filter(r => r.kind === k);
      if (items.length) groups.push([k, items]);
    }
  } else if (filtered.length) {
    groups.push([scope as ResultKind, filtered]);
  }

  return groups;
}

function flattenGroups(groups: Array<[ResultKind, Array<SearchItem>]>): Array<SearchItem> {
  return groups.flatMap(([, items]) => items);
}

// ── Subcomponents ──

function Kbd({children}: {children: React.ReactNode}) {
  return (
    <kbd className="mono text-[10px] text-[var(--fg-dim)] bg-[color-mix(in_oklch,var(--fg)_5%,transparent)] border border-[var(--line-strong)] border-b-2 px-1.5 py-0.5 rounded-[4px] min-w-[18px] text-center">
      {children}
    </kbd>
  );
}

function ScopeChip({scope, active, count, onClick}: {scope: Scope, active: boolean, count: number, onClick: () => void}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`font-sans text-xs bg-transparent border rounded-full px-2.5 py-1 cursor-pointer inline-flex items-center gap-1.5 transition-colors ${
        active
          ? `text-[var(--accent)] border-[var(--accent-line)] bg-[var(--accent-soft)]`
          : `text-[var(--fg-dim)] border-[var(--line)] hover:text-[var(--fg)] hover:border-[var(--line-strong)]`
      }`}
    >
      {SCOPE_ICONS[scope]}
      {SCOPES.find(s => s.key === scope)!.label}
      {` `}
      <span className={`mono text-[10px] tabular-nums ${active ? `text-[var(--accent)]` : `text-[var(--fg-mute)]`}`}>
        {count}
      </span>
    </button>
  );
}

function ResultGlyph({kind}: {kind: ResultKind}) {
  return (
    <span className="w-8 h-8 border border-[var(--line-strong)] rounded-lg inline-flex items-center justify-center text-[var(--fg-dim)] bg-[color-mix(in_oklch,var(--fg)_3%,transparent)] shrink-0 group-hover:text-[var(--accent)] group-hover:border-[var(--accent-line)] group-hover:bg-[var(--accent-soft)] group-[.active]:text-[var(--accent)] group-[.active]:border-[var(--accent-line)] group-[.active]:bg-[var(--accent-soft)]">
      {KIND_GLYPHS[kind]}
    </span>
  );
}

function Crumbs({crumbs, separator = `›`}: {crumbs: Array<string>, separator?: string}) {
  return (
    <span className="mono text-[10.5px] text-[var(--fg-mute)] tracking-[0.02em] whitespace-nowrap overflow-hidden text-ellipsis">
      {crumbs.map((c, i) => (
        <span key={i}>{i > 0 && <span className="opacity-40 px-1">{separator}</span>}{c}</span>
      ))}
    </span>
  );
}

function GroupHeader({kind, count}: {kind: ResultKind, count: number}) {
  return (
    <div className="flex items-center gap-2.5 px-5 pt-3.5 pb-1.5 mono text-[10.5px] text-[var(--fg-mute)] tracking-[0.12em] uppercase">
      <span>{KIND_LABELS[kind]}</span>
      <span className="flex-1 h-px bg-[var(--line)]"/>
      <span className="tabular-nums tracking-[0.04em]">{count}</span>
    </div>
  );
}

function DocResultRow({item, isActive, onMouseEnter, onClick}: {item: SearchItem, isActive: boolean, onMouseEnter: () => void, onClick: () => void}) {
  return (
    <a
      className={`search-result-row group grid grid-cols-[32px_1fr_auto] gap-3.5 items-center px-5 py-2.5 cursor-pointer border-l-2 no-underline text-inherit transition-[background] duration-100 ${
        isActive ? `active bg-[color-mix(in_oklch,var(--fg)_5%,transparent)] border-l-[var(--accent)]` : `border-l-transparent`
      } hover:bg-[color-mix(in_oklch,var(--fg)_5%,transparent)] hover:border-l-[var(--accent)]`}
      href={item.href}
      onMouseEnter={onMouseEnter}
      onClick={e => { e.preventDefault(); onClick(); }}
      role="option"
      aria-selected={isActive}
    >
      <ResultGlyph kind={item.kind}/>
      <span className="min-w-0">
        <span className="text-sm text-[var(--fg)] font-medium truncate block" dangerouslySetInnerHTML={{__html: item.titleHtml}}/>
        {item.snippetHtml && (
          <span className="search-snippet-clamp text-[12.5px] text-[var(--fg-dim)] mt-0.5 leading-[1.45]" dangerouslySetInnerHTML={{__html: item.snippetHtml}}/>
        )}
      </span>
      <span className="flex flex-col items-end gap-1.5 mono text-[10.5px] text-[var(--fg-mute)] whitespace-nowrap shrink-0">
        {item.crumbs && item.crumbs.length > 0 && <Crumbs crumbs={item.crumbs}/>}
        <span className={`inline-flex items-center gap-1.5 mono text-[10px] text-[var(--accent)] transition-opacity duration-150 ${isActive ? `opacity-100` : `opacity-0 group-hover:opacity-100`}`}>
          <Kbd>↵</Kbd> open
        </span>
      </span>
    </a>
  );
}

function PkgResultRow({item, isActive, onMouseEnter, onClick}: {item: SearchItem, isActive: boolean, onMouseEnter: () => void, onClick: () => void}) {
  const flameColor = getFlameColor(item.downloadsRaw);

  return (
    <a
      className={`search-result-row group grid grid-cols-[32px_1fr_auto] gap-3.5 items-center px-5 py-2.5 cursor-pointer border-l-2 no-underline text-inherit transition-[background] duration-100 ${
        isActive ? `active bg-[color-mix(in_oklch,var(--fg)_5%,transparent)] border-l-[var(--accent)]` : `border-l-transparent`
      } hover:bg-[color-mix(in_oklch,var(--fg)_5%,transparent)] hover:border-l-[var(--accent)]`}
      href={item.href}
      onMouseEnter={onMouseEnter}
      onClick={e => { e.preventDefault(); onClick(); }}
      role="option"
      aria-selected={isActive}
    >
      <ResultGlyph kind="pkg"/>
      <span className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-[var(--fg)] font-medium mono truncate" dangerouslySetInnerHTML={{__html: item.titleHtml}}/>
          {item.downloads && flameColor && (
            <span className="mono text-[10.5px] tabular-nums inline-flex items-center gap-1">
              <FlameIcon color={flameColor}/>
              {item.downloads}
            </span>
          )}
        </div>
        <span className="search-snippet-clamp text-[12.5px] text-[var(--fg-dim)] mt-0.5 leading-[1.45]" dangerouslySetInnerHTML={{__html: item.snippetHtml || ``}}/>
        <span className="mono text-[10.5px] text-[var(--fg-mute)] tracking-[0.02em] mt-0.5 block">
          <span>{item.author}</span>
          <span className="opacity-40 px-1">·</span>
          <span>{item.license}</span>
        </span>
      </span>
      <span className="flex flex-col items-end gap-1.5 mono text-[10.5px] text-[var(--fg-mute)] whitespace-nowrap shrink-0">
        {item.version && (
          <span className="bg-[color-mix(in_oklch,var(--fg)_5%,transparent)] border border-[var(--line)] px-[7px] py-0.5 rounded-full text-[var(--fg-dim)]">
            {item.version}
          </span>
        )}
      </span>
    </a>
  );
}

function ResultGroups({groups, activeIdx, onHover, onSelect}: {
  groups: Array<[ResultKind, Array<SearchItem>]>;
  activeIdx: number;
  onHover: (idx: number) => void;
  onSelect: (item: SearchItem) => void;
}) {
  let idx = 0;
  return (
    <>
      {groups.map(([kind, items]) => (
        <div key={kind}>
          <GroupHeader kind={kind} count={items.length}/>
          {items.map(item => {
            const myIdx = idx++;
            const Row = item.kind === `pkg` ? PkgResultRow : DocResultRow;
            return (
              <Row
                key={`${kind}-${myIdx}`}
                item={item}
                isActive={myIdx === activeIdx}
                onMouseEnter={() => onHover(myIdx)}
                onClick={() => onSelect(item)}
              />
            );
          })}
        </div>
      ))}
    </>
  );
}

function EmptyState({onSelect}: {onSelect: (term: string) => void}) {
  const recents = getRecents();

  return (
    <div className="py-2 pb-4">
      {recents.length > 0 && (
        <div className="px-5 py-1.5 pb-2.5">
          <div className="mono text-[10.5px] text-[var(--fg-mute)] tracking-[0.12em] uppercase mb-2">Recent</div>
          {recents.map((r, i) => (
            <div
              key={i}
              onClick={() => onSelect(r.term)}
              className="flex items-center gap-2.5 py-2 px-1 rounded-lg cursor-pointer text-[var(--fg-dim)] text-[13.5px] transition-colors hover:text-[var(--fg)] hover:bg-[color-mix(in_oklch,var(--fg)_4%,transparent)] hover:pl-2"
            >
              <span className="text-[var(--fg-mute)] shrink-0"><ClockIcon/></span>
              <span className="flex-1">{r.term}</span>
              <span className="mono text-[10px] text-[var(--fg-mute)] tracking-[0.04em] uppercase">{r.kind}</span>
            </div>
          ))}
        </div>
      )}
      <div className="px-5 py-1.5 pb-2.5">
        <div className="mono text-[10.5px] text-[var(--fg-mute)] tracking-[0.12em] uppercase mb-2">Suggested</div>
        <div className="grid grid-cols-2 gap-2">
          {SUGGESTED.map((term, i) => (
            <div
              key={i}
              onClick={() => onSelect(term)}
              className="border border-[var(--line)] rounded-[10px] px-3 py-2.5 bg-[color-mix(in_oklch,var(--fg)_2%,transparent)] cursor-pointer flex items-center gap-2.5 transition-colors hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)] group"
            >
              <span className="mono text-[10px] text-[var(--fg-mute)] tracking-[0.08em]">{String(i + 1).padStart(2, `0`)}</span>
              <span className="text-[13px] text-[var(--fg)] flex-1 group-hover:text-[var(--accent)]">{term}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NoResults({query}: {query: string}) {
  return (
    <div className="py-15 px-5 text-center">
      <div className="w-11 h-11 border border-[var(--line-strong)] rounded-full inline-flex items-center justify-center text-[var(--fg-mute)] mb-3.5">
        <NoResultsIcon/>
      </div>
      <div className="text-[var(--fg)] text-[15px] mb-1.5">No matches</div>
      <div className="text-[var(--fg-mute)] text-[13px]">
        Nothing for <span className="text-[var(--fg-dim)] mono">"{query}"</span> in this scope.
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-t border-[var(--line)] bg-[color-mix(in_oklch,var(--bg-0)_30%,transparent)] text-[11.5px] text-[var(--fg-mute)]">
      <div className="flex gap-3.5 items-center flex-wrap">
        <span className="inline-flex items-center gap-1.5"><Kbd>↵</Kbd> open</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>tab</Kbd> filter</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>esc</Kbd> close</span>
      </div>
      <span className="inline-flex items-center gap-1.5 mono">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]"/>
        search by Algolia
      </span>
    </div>
  );
}

// ── Main component ──

export default function SearchModal() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(``);
  const [scope, setScope] = useState<Scope>(`all`);
  const [results, setResults] = useState<Array<SearchItem>>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openModal = useCallback(() => {
    setOpen(true);
    setQuery(``);
    setResults([]);
    setActiveIdx(0);
  }, []);

  const closeModal = useCallback(() => {
    setOpen(false);
    setQuery(``);
    setResults([]);
  }, []);

  // Cmd+K global shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === `k`) {
        e.preventDefault();
        if (open) closeModal();
        else openModal();
      }
    };
    document.addEventListener(`keydown`, handleKeyDown);
    return () => document.removeEventListener(`keydown`, handleKeyDown);
  }, [open, openModal, closeModal]);

  // Wire nav search trigger
  useEffect(() => {
    const trigger = document.querySelector<HTMLElement>(`nav [role="search"]`);
    if (!trigger) return;

    const handleClick = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      openModal();
    };

    trigger.addEventListener(`click`, handleClick);
    return () => trigger.removeEventListener(`click`, handleClick);
  }, [openModal]);

  // Body scroll lock + autofocus
  useEffect(() => {
    if (open) {
      document.body.style.overflow = `hidden`;
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      document.body.style.overflow = ``;
    }
  }, [open]);

  // Algolia search
  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const [docsResponse, pkgResponse] = await Promise.all([
        docsClient.search([{
          indexName: `yarnpkg_next`,
          query: q,
          params: {
            hitsPerPage: 15,
            attributesToHighlight: [`hierarchy.lvl0`, `hierarchy.lvl1`, `hierarchy.lvl2`, `hierarchy.lvl3`, `hierarchy.lvl4`, `hierarchy.lvl5`, `hierarchy.lvl6`, `content`],
            attributesToSnippet: [`content:30`],
          },
        }]),
        pkgClient.search([{
          indexName: `npm-search`,
          query: q,
          params: {
            hitsPerPage: 10,
            attributesToRetrieve: [`name`, `version`, `description`, `owner`, `humanDownloadsLast30Days`, `downloadsLast30Days`, `license`],
            attributesToHighlight: [`name`, `description`],
          },
        }]),
      ]);

      const docsHits: Array<SearchItem> = (docsResponse.results[0] as any)?.hits?.map((hit: any) => {
        const hierarchy = hit.hierarchy || {};
        const levels = [hierarchy.lvl0, hierarchy.lvl1, hierarchy.lvl2, hierarchy.lvl3, hierarchy.lvl4, hierarchy.lvl5, hierarchy.lvl6].filter(Boolean);
        const title = levels[levels.length - 1] || `Untitled`;
        const crumbs = levels.slice(0, -1);
        const url: string = hit.url || ``;
        const isCli = url.includes(`/cli/`) || (hierarchy.lvl0 || ``).toLowerCase().includes(`cli`);

        const snippetHtml = hit._snippetResult?.content?.value || ``;
        const titleHtml = highlightValue(hit, `hierarchy.lvl${levels.length - 1}`);

        return {
          kind: isCli ? `cli` : `docs`,
          title: stripTags(title),
          titleHtml: titleHtml || title,
          crumbs,
          snippet: stripTags(snippetHtml),
          snippetHtml,
          href: url,
        } satisfies SearchItem;
      }) ?? [];

      const pkgHits: Array<SearchItem> = (pkgResponse.results[0] as any)?.hits?.map((hit: any) => ({
        kind: `pkg` as const,
        title: hit.name || ``,
        titleHtml: highlightValue(hit, `name`),
        snippet: stripTags(hit.description || ``),
        snippetHtml: highlightValue(hit, `description`),
        href: `/package/${encodeURIComponent(hit.name)}`,
        version: hit.version,
        downloads: hit.humanDownloadsLast30Days,
        downloadsRaw: hit.downloadsLast30Days,
        author: hit.owner?.name,
        license: hit.license,
      })) ?? [];

      setResults([...docsHits, ...pkgHits]);
      setActiveIdx(0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => search(query), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  const counts: Record<string, number> = {all: results.length, docs: 0, pkg: 0, cli: 0};
  results.forEach(r => counts[r.kind]++);

  const groups = groupResults(results, scope);
  const flatItems = flattenGroups(groups);

  const navigateToResult = useCallback((item: SearchItem) => {
    addRecent(item.title, item.kind);
    window.location.href = item.href;
  }, []);

  const handleSelect = useCallback((term: string) => {
    setQuery(term);
    search(term);
  }, [search]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === `Escape`) {
      e.preventDefault();
      closeModal();
    } else if (e.key === `ArrowDown`) {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === `ArrowUp`) {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === `Enter` && flatItems[activeIdx]) {
      e.preventDefault();
      navigateToResult(flatItems[activeIdx]);
    } else if (e.key === `Tab`) {
      e.preventDefault();
      const scopeKeys = SCOPES.map(s => s.key);
      const curIdx = scopeKeys.indexOf(scope);
      const nextIdx = e.shiftKey
        ? (curIdx - 1 + scopeKeys.length) % scopeKeys.length
        : (curIdx + 1) % scopeKeys.length;
      setScope(scopeKeys[nextIdx]);
      setActiveIdx(0);
    }
  }, [activeIdx, flatItems, scope, closeModal, navigateToResult]);

  // Scroll active into view
  useEffect(() => {
    const el = resultsRef.current?.querySelector(`.active`);
    el?.scrollIntoView({block: `nearest`});
  }, [activeIdx]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-200 flex items-start justify-center pt-[10vh] px-5 pb-5 bg-[color-mix(in_oklch,var(--bg-0)_65%,transparent)] backdrop-blur-[12px] backdrop-saturate-[140%]"
      onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
    >
      <div
        className="w-[min(720px,100%)] bg-[color-mix(in_oklch,var(--bg-1)_80%,transparent)] border border-[var(--line-strong)] rounded-2xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55),0_0_0_1px_color-mix(in_oklch,var(--accent)_14%,transparent),0_0_60px_-12px_color-mix(in_oklch,var(--accent)_30%,transparent)] backdrop-blur-[20px] backdrop-saturate-[160%] overflow-hidden flex flex-col max-h-[78vh] animate-[searchIn_0.18s_cubic-bezier(0.22,1,0.36,1)]"
        role="combobox"
        aria-expanded="true"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center gap-3.5 py-3.5 pl-5 pr-4 border-b border-[var(--line)]">
          <SearchIcon className="text-[var(--fg-mute)] shrink-0"/>
          <input
            ref={inputRef}
            type="search"
            placeholder="Search docs, packages, commands…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 bg-transparent border-0 outline-0 text-[var(--fg)] font-sans text-[17px] tracking-[-0.005em] py-1 min-w-0 placeholder:text-[var(--fg-mute)]"
          />
          {query && (
            <button
              onClick={() => { setQuery(``); setResults([]); inputRef.current?.focus(); }}
              className="bg-transparent border-0 text-[var(--fg-mute)] cursor-pointer w-[22px] h-[22px] rounded-[6px] inline-flex items-center justify-center p-0 transition-colors hover:text-[var(--fg)] hover:bg-[color-mix(in_oklch,var(--fg)_6%,transparent)]"
            >
              <CloseIcon/>
            </button>
          )}
          <button
            onClick={closeModal}
            className="mono text-[10.5px] text-[var(--fg-mute)] border border-[var(--line-strong)] bg-[color-mix(in_oklch,var(--fg)_4%,transparent)] px-[7px] py-[3px] rounded-[5px] tracking-[0.04em] cursor-pointer transition-colors hover:text-[var(--fg)] hover:border-[var(--fg-mute)]"
          >
            esc
          </button>
        </div>

        {/* Scope chips */}
        <div className="flex gap-1 px-3.5 py-2.5 border-b border-[var(--line)] items-center" role="tablist">
          <span className="mono text-[10.5px] text-[var(--fg-mute)] tracking-[0.1em] uppercase mr-2">scope</span>
          {SCOPES.map(s => (
            <ScopeChip
              key={s.key}
              scope={s.key}
              active={scope === s.key}
              count={counts[s.key]}
              onClick={() => { setScope(s.key); setActiveIdx(0); }}
            />
          ))}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto py-2 pb-1 search-results-scroll" ref={resultsRef} role="listbox">
          {query.trim() === `` ? (
            <EmptyState onSelect={handleSelect}/>
          ) : loading && results.length === 0 ? (
            <div className="py-10 px-5 text-center text-[var(--fg-mute)] text-[13px]">
              Searching…
            </div>
          ) : flatItems.length === 0 ? (
            <NoResults query={query}/>
          ) : (
            <ResultGroups
              groups={groups}
              activeIdx={activeIdx}
              onHover={setActiveIdx}
              onSelect={navigateToResult}
            />
          )}
        </div>

        <Footer/>
      </div>
    </div>
  );
}
