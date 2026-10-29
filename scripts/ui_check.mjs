#!/usr/bin/env node
// Visual and accessibility check of pages on the local site at phone, tablet and desktop widths.
//   node ui_check.mjs --base http://localhost:3000 --paths /,/pricing [--widths 375,768,1280] [--schemes light,dark] [--json]
//   node ui_check.mjs --install     one-time: installs the small browser driver (and axe-core) outside the project
// Uses Playwright from the project if present, else from ~/.cache/seo-dev; launches the installed
// Google Chrome when Playwright's own browser is not downloaded. Prefer your built-in browser tools when available.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs, list, emit, repoRoot, scratchDir, writeJson, run, loadConfig, previewUrl, foreignSite, workingTreeHash } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const CACHE = path.join(os.homedir(), '.cache', 'seo-dev');
const PW_VERSION = '1.55.0';
const AXE_VERSION = '4.10.2';

function resolveFrom(dir, name) {
  try { return createRequire(path.join(dir, 'noop.js')).resolve(name); } catch { return null; }
}

async function loadPlaywright(root) {
  for (const dir of [root, CACHE].filter(Boolean)) {
    for (const name of ['playwright', 'playwright-core', '@playwright/test']) {
      const p = resolveFrom(dir, name);
      if (p) { const mod = await import(pathToFileURL(p).href); const pw = mod.chromium ? mod : mod.default; if (pw && pw.chromium) return { pw, from: p }; }
    }
  }
  return null;
}

function axeSource(root) {
  for (const dir of [root, CACHE].filter(Boolean)) {
    const p = resolveFrom(dir, 'axe-core/axe.min.js');
    if (p) return fs.readFileSync(p, 'utf8');
  }
  return null;
}

if (args.install) {
  fs.mkdirSync(CACHE, { recursive: true });
  if (!fs.existsSync(path.join(CACHE, 'package.json'))) fs.writeFileSync(path.join(CACHE, 'package.json'), '{"name":"seo-dev-cache","private":true}\n');
  const r = run('npm', ['install', '--no-audit', '--no-fund', '--prefix', CACHE, `playwright-core@${PW_VERSION}`, `axe-core@${AXE_VERSION}`], { stdio: 'inherit' });
  if (r.code !== 0) { console.error('Install failed.'); process.exit(1); }
  console.log(`Installed into ${CACHE}. If Google Chrome is not installed, also run: npx --prefix "${CACHE}" playwright-core install chromium`);
  process.exit(0);
}

const PAGE_CHECKS = () => {
  const vw = document.documentElement.clientWidth;
  const sel = (el) => {
    if (!el || el === document.body) return 'body';
    const id = el.id ? `#${el.id}` : '';
    const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 3).map((c) => '.' + c.replace(/[^\w-]/g, '')).join('');
    const txt = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`;
  };
  const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 && r.width > 0 && r.height > 0; };
  const clippedByAncestor = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox === 'hidden' || ox === 'auto' || ox === 'scroll' || ox === 'clip') return true; } return false; };
  const out = { width: vw, horizontalScroll: document.documentElement.scrollWidth > vw + 1, overflowing: [], clippedText: [], brokenImages: [], imagesWithoutAlt: 0, smallTargets: [], tinyText: 0, lowContrast: [], edgeText: [], h1: document.querySelectorAll('h1').length };
  // Text that starts or ends right at the screen edge (missing side margin), on phone/tablet widths.
  if (vw < 1100) {
    for (const el of document.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,figcaption,td,th,dt,dd,label')) {
      if (!visible(el) || clippedByAncestor(el)) continue;
      const tn = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (!tn) continue;
      const range = document.createRange(); range.selectNodeContents(tn);
      const r = range.getBoundingClientRect();
      if (r.width && (r.left < 6 || r.right > vw - 6)) { out.edgeText.push(`${sel(el)} (${Math.round(r.left)}..${Math.round(r.right)}px)`); if (out.edgeText.length >= 5) break; }
    }
  }
  if (out.horizontalScroll) {
    const hits = [];
    for (const el of document.querySelectorAll('body *')) {
      if (hits.some((h) => h.contains(el))) continue; // report the outermost too-wide element only
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > vw + 1 || r.left < -1) && visible(el) && !clippedByAncestor(el)) { hits.push(el); out.overflowing.push(`${sel(el)} (${Math.round(r.left)}..${Math.round(r.right)}px)`); if (hits.length >= 6) break; }
    }
  }
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,li,label,td,th,span')) {
    if (!visible(el) || !el.innerText || el.children.length > 3) continue;
    const s = getComputedStyle(el);
    if ((s.overflow === 'hidden' || s.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 2 && s.textOverflow !== 'ellipsis' && !/line-clamp/.test(el.className)) { out.clippedText.push(sel(el)); if (out.clippedText.length >= 8) break; }
  }
  for (const img of document.images) {
    if (img.complete && img.naturalWidth === 0 && img.currentSrc && visible(img)) out.brokenImages.push(img.currentSrc.slice(0, 120));
    if (!img.hasAttribute('alt')) out.imagesWithoutAlt++;
  }
  out.brokenImages = out.brokenImages.slice(0, 10);
  if (vw < 600) {
    for (const el of document.querySelectorAll('a[href],button,[role=button],input:not([type=hidden]),select,textarea')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const inline = getComputedStyle(el).display === 'inline' && el.closest('p,li');
      if ((r.width < 24 || r.height < 24) && !inline) { out.smallTargets.push(`${sel(el)} ${Math.round(r.width)}x${Math.round(r.height)}`); if (out.smallTargets.length >= 10) break; }
    }
  }
  const lum = (c) => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(/[,\s/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };
  const bgOf = (el) => { for (let p = el; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.backgroundImage && s.backgroundImage !== 'none') return null; if (alpha(s.backgroundColor) > 0.9) return s.backgroundColor; } return 'rgb(255,255,255)'; };
  let sampled = 0;
  for (const el of document.querySelectorAll('p,li,a,button,span,h1,h2,h3,h4,td,label')) {
    if (sampled > 400) break;
    if (!visible(el) || !el.innerText || !el.innerText.trim() || [...el.childNodes].every((n) => n.nodeType !== 3 || !n.textContent.trim())) continue;
    sampled++;
    const s = getComputedStyle(el);
    const size = parseFloat(s.fontSize);
    if (size < 12 && vw < 600) out.tinyText++;
    const bg = bgOf(el);
    if (!bg || alpha(s.color) < 0.9) continue;
    const a = lum(s.color), b = lum(bg);
    if (a === null || b === null) continue;
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) { out.lowContrast.push(`${sel(el)} ${ratio.toFixed(2)}:1`); if (out.lowContrast.length >= 8) break; }
  }
  return out;
};

async function main() {
  const root = repoRoot();
  const loaded = await loadPlaywright(root);
  if (!loaded) {
    const msg = 'No browser driver found. Use the built-in browser tools if you have them (screenshots at 375/768/1280 widths + console errors), '
      + `or run once: node ${path.relative(process.cwd(), process.argv[1])} --install  (small one-time download, nothing added to the project).`;
    emit({ ok: false, unavailable: true, message: msg }, msg);
    process.exit(3);
  }
  const { pw } = loaded;
  let browser;
  try { browser = await pw.chromium.launch({ headless: true }); }
  catch { try { browser = await pw.chromium.launch({ headless: true, channel: 'chrome' }); } catch (e) {
    const msg = `Could not start a browser (${e.message.split('\n')[0]}). Install Google Chrome, or run: npx --prefix "${CACHE}" playwright-core install chromium`;
    emit({ ok: false, unavailable: true, message: msg }, msg); process.exit(3);
  } }
  const base = String(args.base || (root && previewUrl(root)) || 'http://localhost:3000').replace(/\/$/, '');
  const cfg = root ? loadConfig(root).config : null;
  const siteWide = new Set();
  const paths = list(args.paths).length ? list(args.paths) : ['/'];
  const widths = list(args.widths).length ? list(args.widths).map(Number) : [375, 768, 1280];
  const schemes = list(args.schemes).length ? list(args.schemes) : ['light'];
  const outDir = args.out ? String(args.out) : root ? scratchDir(root, 'screenshots') : fs.mkdtempSync(path.join(os.tmpdir(), 'seo-shots-'));
  fs.mkdirSync(outDir, { recursive: true });
  const axe = args['no-axe'] ? null : axeSource(root);
  const results = [];

  for (const p of paths) {
    const url = /^https?:/.test(p) ? p : base + (p.startsWith('/') ? p : '/' + p);
    for (const scheme of schemes) for (const width of widths) {
      const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 800 : 900 }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: width < 600, hasTouch: width < 600 });
      const page = await ctx.newPage();
      const consoleErrors = [], failed = [];
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const where = (m.location() && m.location().url) || '';
        if (/favicon\.ico|apple-touch-icon/.test(where)) { siteWide.add('The site has no browser-tab icon (favicon.ico returns 404). Site-wide and harmless for this change; mention it, a developer or the editor can add an icon file.'); return; }
        consoleErrors.push(`${m.text().slice(0, 180)}${where ? ` (${where.replace(/^https?:\/\/[^/]+/, '').slice(0, 100)})` : ''}`);
      });
      page.on('pageerror', (e) => consoleErrors.push(`page error: ${e.message.slice(0, 200)}`));
      page.on('requestfailed', (r) => { const u = r.url(); if (!/analytics|gtag|googletagmanager|posthog|mixpanel|clarity|hotjar|sentry|doubleclick|facebook/.test(u)) failed.push(`failed ${u.slice(0, 120)}`); });
      page.on('response', (r) => { try { if (r.status() >= 400 && new URL(r.url()).origin === new URL(url).origin) failed.push(`${r.status()} ${new URL(r.url()).pathname.slice(0, 100)}`); } catch { /* ignore */ } });
      const res = { path: p, width, scheme, status: 0, consoleErrors, failedRequests: failed };
      try {
        const resp = await page.goto(url, { waitUntil: 'load', timeout: Number(args.timeout || 90) * 1000 });
        res.status = resp ? resp.status() : 0;
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
        // Open collapsed FAQs/accordions and hide framework dev badges so screenshots show the real page.
        await page.evaluate(() => {
          for (const d of document.querySelectorAll('details')) d.open = true;
          const st = document.createElement('style');
          st.textContent = 'nextjs-portal,[data-nextjs-toast],[data-nextjs-dev-tools-button],vite-error-overlay,#__nuxt-devtools,nuxt-devtools-frame,astro-dev-toolbar{display:none!important}';
          document.head.appendChild(st);
        });
        if (cfg && !res.foreign) { const other = foreignSite(await page.content(), cfg); if (other) { res.foreign = other; } }
        await page.evaluate(async () => { const h = document.body.scrollHeight; for (let y = 0; y < h; y += window.innerHeight * 0.8) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
        await page.waitForTimeout(400);
        Object.assign(res, await page.evaluate(PAGE_CHECKS));
        if (axe) {
          await page.addScriptTag({ content: axe });
          const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length, example: (x.nodes[0] && x.nodes[0].target.join(' ')) || '' })));
          res.a11y = v.filter((x) => x.impact === 'critical' || x.impact === 'serious').slice(0, 12);
        }
        const slug = (p.replace(/^https?:\/\/[^/]+/, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'home').slice(0, 60);
        res.screenshot = path.join(outDir, `${slug}-${width}${scheme === 'dark' ? '-dark' : ''}.png`);
        await page.screenshot({ path: res.screenshot, fullPage: true, timeout: 60000 }).catch(async () => page.screenshot({ path: res.screenshot }));
      } catch (e) {
        res.error = e.message.split('\n')[0];
      }
      await ctx.close();
      results.push(res);
    }
    // One side-by-side image per page and colour scheme, so all widths can be looked at in one go.
    for (const scheme of schemes) {
      const shots = results.filter((r) => r.path === p && r.scheme === scheme && r.screenshot && fs.existsSync(r.screenshot));
      if (shots.length < 2) continue;
      // Scale every shot by the same factor so a phone stays narrow and a page wider than its screen stands out.
      const pngWidth = (f) => { const b = fs.readFileSync(f); return b.readUInt32BE(16); };
      const k = Math.min(1, 1440 / shots.reduce((n, r) => n + Math.max(r.width, pngWidth(r.screenshot)) + 12, 0));
      const imgs = shots.map((r) => {
        const w = pngWidth(r.screenshot);
        const note = w > r.width + 1 ? ` - page is ${w}px wide, wider than the screen!` : '';
        return `<figure style="width:${Math.round(Math.max(r.width, w) * k)}px"><figcaption>${r.width}px screen${note}</figcaption><img style="width:${Math.round(w * k)}px" src="data:image/png;base64,${fs.readFileSync(r.screenshot).toString('base64')}"><div class="edge" style="left:${Math.round(r.width * k)}px"></div></figure>`;
      }).join('');
      const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
      const pg = await ctx.newPage();
      await pg.setContent(`<style>body{margin:0;background:#888;font:14px sans-serif;display:flex;gap:12px;align-items:flex-start;padding:12px}figure{margin:0;background:#fff;position:relative}figcaption{padding:4px 8px;background:#222;color:#fff;white-space:nowrap;overflow:hidden}img{display:block;height:auto}.edge{position:absolute;top:0;bottom:0;border-left:2px dashed #e11}</style>${imgs}`);
      const sheet = shots[0].screenshot.replace(/-\d+(-dark)?\.png$/, `-sheet${scheme === 'dark' ? '-dark' : ''}.png`);
      await pg.screenshot({ path: sheet, fullPage: true }).catch(() => {});
      await ctx.close();
      for (const r of shots) r.sheet = sheet;
    }
  }
  await browser.close();

  const problems = (r) => {
    const out = [];
    if (r.foreign) out.push(['error', `this page belongs to another website (${r.foreign}): the preview is on a different address; use the URL serve.mjs printed`]);
    if (r.error) out.push(['error', `could not load: ${r.error}`]);
    if (r.status >= 400) out.push(['error', `HTTP ${r.status}`]);
    if (r.horizontalScroll) out.push(['error', `page scrolls sideways at ${r.width}px; wider than the screen: ${r.overflowing.join('; ') || 'unknown element'}`]);
    for (const b of r.brokenImages || []) out.push(['error', `broken image ${b}`]);
    for (const c of (r.consoleErrors || []).slice(0, 6)) out.push(['warning', `console: ${c}`]);
    for (const f of [...new Set(r.failedRequests || [])].slice(0, 6)) out.push(['warning', `request ${f}`]);
    if ((r.clippedText || []).length) out.push(['warning', `text cut off: ${r.clippedText.join('; ')}`]);
    if ((r.edgeText || []).length) out.push(['warning', `text touches the screen edge (no side margin): ${r.edgeText.join('; ')}`]);
    if ((r.smallTargets || []).length) out.push(['warning', `tap targets smaller than 24px: ${r.smallTargets.slice(0, 5).join('; ')}`]);
    if (r.tinyText > 3) out.push(['warning', `${r.tinyText} text elements under 12px on mobile`]);
    if ((r.lowContrast || []).length) out.push(['warning', `low contrast text: ${r.lowContrast.join('; ')}`]);
    if (r.imagesWithoutAlt) out.push(['warning', `${r.imagesWithoutAlt} image(s) without alt`]);
    if (r.h1 !== undefined && r.h1 !== 1) out.push(['warning', `${r.h1} H1 headings`]);
    for (const a of r.a11y || []) out.push(['warning', `a11y ${a.impact}: ${a.help} (${a.nodes}x, e.g. ${a.example})`]);
    return out;
  };
  const errors = results.reduce((n, r) => n + problems(r).filter(([l]) => l === 'error').length, 0);
  const report = { ok: errors === 0, errors, results: results.map((r) => ({ ...r, problems: problems(r).map(([level, msg]) => ({ level, msg })) })), siteWide: [...siteWide], axe: !!axe };
  if (root) {
    report.tree = workingTreeHash(root, cfg); report.at = new Date().toISOString(); report.widths = widths; report.paths = paths;
    writeJson(path.join(scratchDir(root, 'reports'), 'ui-check.json'), report);
  }
  const lines = [];
  const sheets = [...new Set(report.results.map((r) => r.sheet).filter(Boolean))];
  if (sheets.length) lines.push(`Open these side-by-side images (all widths in one) and really look at them:\n${sheets.map((x) => `  ${x}`).join('\n')}`);
  for (const r of report.results) {
    const n = r.problems.length;
    lines.push(`${r.path} @ ${r.width}px${r.scheme === 'dark' ? ' dark' : ''}: ${n ? `${n} problem(s)` : 'no automatic findings'}${r.screenshot ? `  screenshot: ${r.screenshot}` : ''}`);
    for (const pr of r.problems) lines.push(`  ${pr.level.toUpperCase()}: ${pr.msg}`);
  }
  for (const w of siteWide) lines.push(`SITE-WIDE NOTE: ${w}`);
  if (!axe) lines.push('(axe accessibility rules not run: axe-core not installed; run --install to add it)');
  lines.push(`RESULT: ${errors ? `${errors} UI error(s) to fix` : 'no blocking UI errors'} - also LOOK at the screenshots: alignment, spacing, overlaps and anything that looks off`);
  emit(report, lines.join('\n'));
  process.exit(errors ? 2 : 0);
}

main();
