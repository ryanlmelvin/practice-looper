import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';

async function filesAt(dir) {
  const result = [];
  for (const entry of await readdir(dir, {withFileTypes:true})) {
    const name = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await filesAt(name));
    else result.push(name);
  }
  return result.sort();
}
const inputs = [...await filesAt('src'), ...await filesAt('public'), 'scripts/sw-template.js', 'scripts/build.mjs', 'package-lock.json', 'LICENSE'].sort();
const hash = createHash('sha256');
for (const input of inputs) { hash.update(input); hash.update(await readFile(input)); }
const version = hash.digest('hex').slice(0,12);
await rm('docs', { recursive:true, force:true });
await mkdir('docs/assets', {recursive:true});
await cp('public', 'docs', {recursive:true});
await cp('LICENSE', 'docs/LICENSE.txt');
const output = await build({entryPoints:['src/app.js'],bundle:true,format:'esm',target:['safari16.4','chrome110'],minify:true,entryNames:'app-[hash]',outdir:'docs/assets',metafile:true,legalComments:'eof'});
const appFile = Object.keys(output.metafile.outputs).find(file=>file.endsWith('.js')).replace('docs/','./');
const css = await readFile('public/styles.css');
const cssName = `styles-${createHash('sha256').update(css).digest('hex').slice(0,12)}.css`;
await writeFile(`docs/assets/${cssName}`,css);
await rm('docs/styles.css');
let html = await readFile('public/index.html','utf8');
html = html.replaceAll('__APP_SCRIPT__',appFile).replaceAll('__APP_STYLE__',`./assets/${cssName}`).replaceAll('__RELEASE__',version);
await writeFile('docs/index.html',html);
await writeFile('docs/release.json',JSON.stringify({version})+'\n');
await writeFile('docs/.nojekyll','');
const precache = (await filesAt('docs')).filter(file => !file.endsWith('/update.html') && !file.endsWith('/.nojekyll')).map(file => file.replace('docs/','./'));
const worker = (await readFile('scripts/sw-template.js','utf8')).replaceAll('__RELEASE__',version).replace('__PRECACHE__',JSON.stringify(precache));
await writeFile('docs/sw.js',worker);
console.log(`Built Riffbolt ${version} (${precache.length} offline assets)`);
