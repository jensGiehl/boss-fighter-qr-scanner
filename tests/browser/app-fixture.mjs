import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const staticDirectory = fileURLToPath(new URL('../../src/main/resources/static/', import.meta.url));

function jarEntry(archive, name) {
  let end = archive.length - 22;
  while (end >= Math.max(0, archive.length - 65557) && archive.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0 && archive.readUInt32LE(end) === 0x06054b50, 'The Bootstrap Webjar must be a ZIP archive');
  let offset = archive.readUInt32LE(end + 16);
  const count = archive.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50);
    const nameLength = archive.readUInt16LE(offset + 28);
    const entryName = archive.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (entryName === name) {
      const position = archive.readUInt32LE(offset + 42);
      const start = position + 30 + archive.readUInt16LE(position + 26) + archive.readUInt16LE(position + 28);
      const data = archive.subarray(start, start + archive.readUInt32LE(offset + 20));
      const method = archive.readUInt16LE(offset + 10);
      assert.ok(method === 0 || method === 8, 'The Bootstrap Webjar uses a supported compression method');
      return method === 8 ? inflateRawSync(data) : data;
    }
    offset += 46 + nameLength + archive.readUInt16LE(offset + 30) + archive.readUInt16LE(offset + 32);
  }
  throw new Error(`The Bootstrap Webjar does not contain ${name}`);
}

export async function bootstrapStyles() {
  const html = await readFile(join(staticDirectory, 'index.html'), 'utf8');
  const asset = html.match(/href="(\/webjars\/bootstrap\/([^/]+)\/css\/bootstrap\.min\.css)"/);
  assert.ok(asset, 'The application must load Bootstrap from its Webjar');
  const repository = process.env.MAVEN_REPOSITORY || join(homedir(), '.m2', 'repository');
  try {
    const archive = await readFile(join(repository, 'org', 'webjars', 'bootstrap', asset[2], `bootstrap-${asset[2]}.jar`));
    return { path: asset[1], content: jarEntry(archive, `META-INF/resources${asset[1]}`) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function startApp(bootstrap, catalog) {
  const cards = [];
  const writes = [];
  const failures = [];
  const resources = new Set();
  const queries = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const json = data => { response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); };
    try {
      if (url.pathname === '/api/catalog') return json(catalog);
      if (url.pathname === '/api/effect-names') return json([]);
      if (url.pathname === '/api/cards' && request.method === 'GET') {
        queries.push(new URLSearchParams(url.searchParams));
        const deckId = url.searchParams.get('deckId');
        const filtered = deckId ? cards.filter(card => card.deckId === deckId) : cards;
        return json({ content: filtered, totalElements: filtered.length, totalPages: filtered.length ? 1 : 0 });
      }
      if ((url.pathname === '/api/cards' && request.method === 'POST') || (/^\/api\/cards\/.+/.test(url.pathname) && request.method === 'PUT')) {
        let body = '';
        for await (const chunk of request) body += chunk;
        const payload = JSON.parse(body);
        writes.push({ method: request.method, payload });
        const saved = { ...payload, id: 'card-1', version: writes.length - 1 };
        cards.splice(0, cards.length, saved);
        return json(saved);
      }
      if (url.pathname === '/api/cards/card-1') return json(cards[0]);
      resources.add(url.pathname);
      if (url.pathname === bootstrap.path) {
        response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        return response.end(bootstrap.content);
      }
      if (/^\/webjars\/jsqr\//.test(url.pathname)) {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        return response.end('window.jsQR = () => null;');
      }
      const path = resolve(staticDirectory, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
      assert.ok(path.startsWith(resolve(staticDirectory) + sep), 'Static files must stay in the application directory');
      const content = await readFile(path);
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      response.writeHead(200, { 'Content-Type': `${types[extname(path)] || 'application/octet-stream'}; charset=utf-8` });
      response.end(content);
    } catch (error) {
      failures.push(`${request.method} ${url.pathname}: ${error.message}`);
      response.writeHead(500);
      response.end('Fixture request failed');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, server, writes, failures, resources, queries };
}
