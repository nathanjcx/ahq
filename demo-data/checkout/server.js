import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/checkout.js', ['checkout.js', 'text/javascript; charset=utf-8']],
]);

createServer(async (request, response) => {
  const file = files.get(new URL(request.url, 'http://localhost').pathname);
  if (!file || request.method !== 'GET') {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': file[1] }).end(body);
  } catch {
    response.writeHead(500).end('Unable to load checkout');
  }
}).listen(Number(process.env.PORT || 4179), '127.0.0.1', () => {
  console.log(`Checkout running at http://127.0.0.1:${process.env.PORT || 4179}`);
});
