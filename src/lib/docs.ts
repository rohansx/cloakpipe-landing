// Docs sidebar and reading order (prev/next follow this list).
export interface DocLink { title: string; href: string }
export interface DocGroup { label: string; items: DocLink[] }

export const DOCS: DocGroup[] = [
  {
    label: 'Start here',
    items: [
      { title: 'Overview', href: '/docs' },
      { title: 'Quick start', href: '/docs/quickstart' },
    ],
  },
  {
    label: 'Evaluate & certify',
    items: [
      { title: 'Agent releases', href: '/docs/releases' },
      { title: 'Evaluation import', href: '/docs/evaluation' },
      { title: 'Certification', href: '/docs/certification' },
    ],
  },
  {
    label: 'Enforce & prove',
    items: [
      { title: 'Runtime enforcement', href: '/docs/runtime' },
      { title: 'MCP tool gate', href: '/docs/mcp-gate' },
      { title: 'Evidence & verification', href: '/docs/evidence' },
      { title: 'Audit packs', href: '/docs/audit-pack' },
    ],
  },
  {
    label: 'Reference',
    items: [
      { title: 'Integrations', href: '/docs/integrations' },
      { title: 'FAQ & limitations', href: '/docs/faq' },
    ],
  },
];

export const DOC_ORDER: DocLink[] = DOCS.flatMap((g) => g.items);

export function normalise(path: string): string {
  const p = path.replace(/\/index\.html$/, '').replace(/\.html$/, '').replace(/\/+$/, '');
  return p === '' ? '/' : p;
}
