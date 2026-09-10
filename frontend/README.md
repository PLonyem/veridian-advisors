# Veridian Global Advisors — Frontend

Static HTML/CSS/JS, no framework, with the existing design preserved and the intake form integrated with the secured backend contract.

## Local development

The backend (`../veridian-backend`) runs on its own port (`5000` by default -
see its `.env`). The frontend's JS calls the API with **relative** URLs
(`fetch('/api/submit-lead')`, matching `<form action="/api/submit-lead">`) so
that in production Vercel can expose a same-origin path without browser-side
backend configuration.

In development they're two separate processes on two different ports, so a
plain static file server won't work for anything that calls the API - a
relative `/api/submit-lead` fetched from a page on `:3000` resolves to
`http://localhost:3000/api/submit-lead`, not the backend on `:5000`. Use the
bundled dev server instead of a plain static server; it serves the same
files but also proxies `/api/*` to the backend, so relative URLs resolve
correctly and there's no dependency on CORS to bridge the two origins:

```bash
npm ci
npm run dev   # serves this directory on :3000, proxies /api/* to :5000
```

Override either port if needed: `PORT=3001 BACKEND_URL=http://localhost:5050 npm run dev`.

If you only need to preview pages that don't call the API, a plain static
server still works fine:

```bash
npx http-server . -p 8080
```

## Clean URLs (`/pricing` instead of `/pricing.html`)

`sitemap.xml`, every page's `<link rel="canonical">`, and `og:url` all declare
the clean-URL form (e.g. `https://www.veridianglobal.com/pricing`) — that's
the correct SEO target regardless of how the files are actually served.

Making those URLs actually resolve requires a server rewrite, since this is a
plain static file server with no rewrite layer of its own:

- **Netlify**: `_redirects` in this directory already maps each clean URL to
  its `.html` file (as a rewrite, so the address bar keeps the clean URL).
- **Vercel**: `vercel.json` does the same via `rewrites`.
- **Other hosts** (nginx, Apache, etc.): add equivalent rewrite rules before
  relying on the clean URLs.

**Internal links across the site (`nav`, footer, all cross-page links) still
point at the `.html` files.** That's a deliberate choice, not an oversight:
changing every internal `href` sitewide to the extension-less form only works
once the rewrites above are actually deployed — do that first, verify it on
the live site, then update the internal links in a follow-up pass. Until
then, `.html` links work everywhere unconditionally, on any host, with no
dependency on rewrite config being correctly deployed.

## Production build (minification)

```bash
npm ci
npm run build
```

Outputs a deployable copy of this directory to `dist/`, with every `.css`
and `.js` file minified via esbuild. HTML, `robots.txt`, `sitemap.xml`, and
the rewrite config files are copied through unchanged — nothing referencing
them needs to change, since minified output keeps the same file paths as the
source. Point your production host at `dist/`, not this directory.

`vercel.json` uses a fixed external rewrite for `/api/*` and sends `/admin`
to the backend-owned staff origin. Confirm the checked Render hostname after
service creation before deploying. The intake script loads the current notice
version and package prices from `/api/v1/public-config`, then submits strict
JSON with a stable `Idempotency-Key`; it never stores staff credentials.
