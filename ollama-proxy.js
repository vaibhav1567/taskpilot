import 'dotenv/config';
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const token = process.env.TASKPILOT_OLLAMA_TOKEN?.trim();
if (!token || token.length < 32) {
  console.error('Set TASKPILOT_OLLAMA_TOKEN in your local .env to a random value of at least 32 characters.');
  process.exit(1);
}

const port = Number(process.env.TASKPILOT_OLLAMA_PROXY_PORT) || 11435;
const server = http.createServer((req, res) => {
  // Only allow the one OpenAI-compatible endpoint this app uses.
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const expected = Buffer.from(token);
  const match = /^Bearer\s+([^\s]+)$/i.exec(req.headers.authorization || '');
  const provided = Buffer.from(match?.[1] || '');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const upstream = http.request({
    hostname: '127.0.0.1',
    port: 11434,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:11434', authorization: 'Bearer ollama' },
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Local Ollama is unavailable.' }));
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Authenticated Ollama proxy listening on http://127.0.0.1:${port}`);
});
