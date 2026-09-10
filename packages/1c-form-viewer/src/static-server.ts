import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export class StaticAssetServer {
  private server: Server | null = null;
  private readonly token = randomBytes(24).toString('hex');
  private port = 0;

  constructor(private readonly assetsDir: string) {}

  async start(): Promise<string> {
    if (this.server) return this.url();
    const root = await fs.realpath(this.assetsDir);
    this.server = createServer(async (request, response) => {
      try {
        const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
        const prefix = `/${this.token}/`;
        if (!requestUrl.pathname.startsWith(prefix)) {
          response.writeHead(404).end();
          return;
        }
        const relative = decodeURIComponent(requestUrl.pathname.slice(prefix.length)) || 'index.html';
        const candidate = path.resolve(root, relative);
        if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
          response.writeHead(403).end();
          return;
        }
        const body = await fs.readFile(candidate);
        response.writeHead(200, {
          'Content-Type': MIME[path.extname(candidate).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'",
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind local preview server');
    this.port = address.port;
    return this.url();
  }

  url(): string {
    if (!this.port) throw new Error('Preview server is not running');
    return `http://127.0.0.1:${this.port}/${this.token}/index.html`;
  }

  async close(): Promise<void> {
    const current = this.server;
    this.server = null;
    this.port = 0;
    if (!current) return;
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }
}

