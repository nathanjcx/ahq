import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.OFFICE_DATA_DIR || path.join(root, '.local-data', 'preview');
const token = randomBytes(32).toString('hex');
const port = Number(process.env.OFFICE_PORT || 4318);
const origin = `http://127.0.0.1:${port}`;
const child = fork(path.join(root, 'dist-electron/runtime-host.cjs'), [], {
  env: { ...process.env, OFFICE_DATA_DIR: dataDir }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
});
let snapshot;
let sequence = 0;
const pending = new Map();
const clients = new Set();
function command(command) {
  if (!child.connected) return Promise.reject(new Error('The local runtime stopped.'));
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Runtime request timed out.')); }, 60_000);
    pending.set(id, { resolve, reject, timer });
    child.send({ id, command });
  });
}
child.on('message', (message) => {
  if (message.type === 'snapshot') {
    snapshot = message.snapshot;
    for (const response of clients) response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  } else if (message.type === 'fatal') console.error(message.error);
  else if (pending.has(message.id)) {
    const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error));
    else { snapshot = message.result; item.resolve(message.result); }
  }
});
child.on('exit', () => {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('The local runtime stopped.')); }
  pending.clear();
});
function validToken(candidate) {
  return typeof candidate === 'string' && candidate.length === token.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
function json(response, status, data) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); }
const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  try {
    if (request.headers.host !== `127.0.0.1:${port}`) return json(response, 403, { error: 'Invalid host' });
    const url = new URL(request.url || '/', origin);
    if (url.pathname.startsWith('/api/')) {
      const cookie = request.headers.cookie?.split('; ').find((part) => part.startsWith('office='))?.slice(7);
      if (!validToken(cookie)) return json(response, 403, { error: 'Open the local preview first.' });
      if (url.pathname === '/api/events' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        response.write(': connected\n\n'); clients.add(response);
        if (snapshot) response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20_000);
        request.on('close', () => { clients.delete(response); clearInterval(heartbeat); });
        return;
      }
      if (!validToken(request.headers['x-office-token'])) return json(response, 403, { error: 'Invalid request token' });
      if (url.pathname === '/api/command' && request.method === 'POST') {
        if (request.headers.origin !== origin) return json(response, 403, { error: 'Invalid origin' });
        let body = '';
        for await (const chunk of request) { body += chunk; if (body.length > 64_000) return json(response, 413, { error: 'Request is too large' }); }
        return json(response, 200, await command(JSON.parse(body)));
      }
      if (url.pathname.startsWith('/api/artifact/') && request.method === 'GET') {
        const id = decodeURIComponent(url.pathname.slice('/api/artifact/'.length));
        const artifact = snapshot?.artifacts.find((item) => item.id === id);
        if (!artifact) return json(response, 404, { error: 'Artifact not found' });
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.setHeader('X-Artifact-Name', `${artifact.kind}-${artifact.id.replace(/[^a-zA-Z0-9-]/g, '')}.md`);
        response.end(artifact.content);
        return;
      }
      return json(response, 404, { error: 'Unknown route' });
    }
    if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
    const file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    const dist = await realpath(path.join(root, 'dist'));
    const resolved = await realpath(path.join(dist, file));
    const relative = path.relative(dist, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !(await stat(resolved)).isFile()) return json(response, 404, { error: 'File not found' });
    let content = await readFile(resolved);
    if (file === 'index.html') {
      response.setHeader('Set-Cookie', `office=${token}; HttpOnly; SameSite=Strict; Path=/`);
      content = Buffer.from(content.toString().replace('<head>', `<head><meta name="office-token" content="${token}"/>`));
    }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(content);
  } catch (error) {
    if (!response.headersSent) json(response, error.code === 'ENOENT' ? 404 : 400, { error: error.message || 'Request failed' });
    else response.end();
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Little Office preview: ${origin}`));
function close() { for (const response of clients) response.end(); child.kill('SIGTERM'); server.close(() => process.exit(0)); }
process.on('SIGINT', close);
process.on('SIGTERM', close);
