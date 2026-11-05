import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('docs');
const prefix = '/practice-looper/';
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4317);
const mime = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png', '.svg':'image/svg+xml' };
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/' || url.pathname === '/practice-looper') { res.writeHead(302,{Location:prefix});res.end();return; }
    if (!url.pathname.startsWith(prefix)) throw new Error('Not found');
    const relative = decodeURIComponent(url.pathname.slice(prefix.length));
    let file = resolve(root, relative || 'index.html');
    if (!file.startsWith(root + sep)) throw new Error('Not found');
    if ((await stat(file)).isDirectory()) file = resolve(file,'index.html');
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(await readFile(file));
  } catch { res.writeHead(404);res.end('Not found'); }
});
server.listen(port,host,()=>console.log(`Local: http://${host}:${port}${prefix}`));
