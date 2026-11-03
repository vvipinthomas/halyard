// Vetted starter templates for products built from scratch. Halyard (not an agent) writes these files:
// CI/deploy pipeline, dependency manifest and runtime config are fixed, reviewed code. Agents only fill src/, public/, tests/.
export const AGENT_WRITABLE = /^(src|public|tests)\/[A-Za-z0-9_\-./]+\.(js|mjs|html|css|json|svg|md|txt)$/;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'app';
const ci = (deploy) => `name: CI
on:
  push: { branches: [main] }
  pull_request:
permissions: { contents: read }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install --no-audit --no-fund
      - run: npm test
${deploy ? `  deploy:
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
` : ''}`;

export const TEMPLATES = {
  'worker-app': {
    title: 'Web app on Cloudflare Workers',
    description: 'Dependency-free Worker with a JSON API (src/), static UI (public/) and node:test tests. Deploys from main with wrangler-action.',
    rules: 'Runtime: Cloudflare Workers (standard fetch/Request/Response, Web Crypto). Entry: src/index.js exporting default { async fetch(request, env) }. Static files in public/ are served automatically; route /api/* in the Worker. No npm dependencies. Tests: tests/*.test.js using node:test and node:assert/strict, importing src modules and calling fetch() on the default export with new Request(...). Keep state in memory or in env bindings only if declared.',
    files: ({ name, prd }) => ({
      'package.json': JSON.stringify({ name: slug(name), private: true, type: 'module', scripts: { test: 'node --test', dev: 'wrangler dev', deploy: 'wrangler deploy' }, devDependencies: { wrangler: '^4.0.0' } }, null, 2) + '\n',
      'wrangler.toml': `name = "${slug(name)}"\nmain = "src/index.js"\ncompatibility_date = "2026-10-01"\n\n[assets]\ndirectory = "./public"\nrun_worker_first = ["/api/*"]\n`,
      '.github/workflows/ci.yml': ci(true),
      'README.md': `# ${name}\n\n${prd?.problem || ''}\n\nBuilt by Halyard Software Factory.\n\n## Develop\n\n\`\`\`bash\nnpm install\nnpm test\nnpx wrangler dev\n\`\`\`\n\nDeploys to Cloudflare Workers on every push to \`main\` (needs repository secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID).\n`,
      '.gitignore': 'node_modules/\n.wrangler/\n',
    }),
  },
  'static-site': {
    title: 'Static site on Cloudflare',
    description: 'HTML/CSS/JS site in public/ with a tiny Worker for headers; tests check pages and links.',
    rules: 'Static site: pages in public/*.html with shared public/styles.css and public/app.js. src/index.js is a Worker that serves assets (env.ASSETS.fetch) and adds security headers. No npm dependencies. Tests in tests/*.test.js with node:test read files from public/ (node:fs) and assert required pages, titles and internal links exist.',
    files: ({ name, prd }) => ({
      'package.json': JSON.stringify({ name: slug(name), private: true, type: 'module', scripts: { test: 'node --test', dev: 'wrangler dev', deploy: 'wrangler deploy' }, devDependencies: { wrangler: '^4.0.0' } }, null, 2) + '\n',
      'wrangler.toml': `name = "${slug(name)}"\nmain = "src/index.js"\ncompatibility_date = "2026-10-01"\n\n[assets]\ndirectory = "./public"\nbinding = "ASSETS"\n`,
      '.github/workflows/ci.yml': ci(true),
      'README.md': `# ${name}\n\n${prd?.problem || ''}\n\nBuilt by Halyard Software Factory.\n`,
      '.gitignore': 'node_modules/\n.wrangler/\n',
    }),
  },
};
export const templateList = () => Object.entries(TEMPLATES).map(([id, t]) => ({ id, title: t.title, description: t.description }));
