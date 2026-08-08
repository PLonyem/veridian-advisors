/**
 * Production build: copies this directory to dist/, minifying every .css
 * and .js file in place via esbuild. Everything else (HTML, sitemap.xml,
 * robots.txt, _redirects, vercel.json) is copied through unchanged, at the
 * same relative paths - so no file needs to reference a differently-named
 * "minified" asset; dist/css/style.css just IS the minified version of
 * css/style.css. Point your production host at dist/, not this directory.
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// Anything in this directory that shouldn't end up in the deployable build.
const EXCLUDE = new Set(['dist', 'node_modules', 'package.json', 'package-lock.json', 'build.js', '.git']);

function copyRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (srcDir === ROOT && EXCLUDE.has(entry.name)) continue;

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function minifyInPlace(dir, ext, loader) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(ext)) continue;
    const filePath = path.join(dir, file);
    const source = fs.readFileSync(filePath, 'utf8');
    const before = source.length;
    const result = esbuild.transformSync(source, { loader, minify: true });
    fs.writeFileSync(filePath, result.code);
    console.log(`  ${path.relative(ROOT, filePath)}: ${before}b -> ${result.code.length}b`);
  }
}

console.log('Cleaning dist/...');
fs.rmSync(DIST, { recursive: true, force: true });

console.log('Copying frontend/ -> dist/...');
copyRecursive(ROOT, DIST);

console.log('Minifying CSS...');
minifyInPlace(path.join(DIST, 'css'), '.css', 'css');

console.log('Minifying JS...');
minifyInPlace(path.join(DIST, 'js'), '.js', 'js');

console.log('Build complete: dist/');
