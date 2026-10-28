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
    label: 'Declare, enforce, prove',
    items: [
      { title: 'MCP tool gate', href: '/docs/mcp-gate' },
      { title: 'Manifest reference', href: '/docs/manifest' },
      { title: 'Policy (Cedar)', href: '/docs/policy' },
      { title: 'Evidence & verification', href: '/docs/evidence' },
      { title: 'Alerts & events', href: '/docs/events' },
    ],
  },
  {
    label: 'Security',
    items: [
      { title: 'Threat model', href: '/docs/threat-model' },
      { title: 'Keys', href: '/docs/keys' },
    ],
  },
  {
    label: 'Reference',
    items: [
      { title: 'Integrations', href: '/docs/integrations' },
      { title: 'Docker', href: '/docs/docker' },
      { title: 'Comparison', href: '/docs/comparison' },
      { title: 'FAQ & limitations', href: '/docs/faq' },
      { title: 'Changelog', href: '/changelog' },
    ],
  },
];

export const DOC_ORDER: DocLink[] = DOCS.flatMap((g) => g.items);

export function normalise(path: string): string {
  const p = path.replace(/\/index\.html$/, '').replace(/\.html$/, '').replace(/\/+$/, '');
  return p === '' ? '/' : p;
}
