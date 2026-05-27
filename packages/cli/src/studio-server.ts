/**
 * HTTP server for the project studio (RFC-05 §UI).
 * Serves @html-video/project-studio static UI + project / template REST APIs.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, copyFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { CliContext } from './context.js';
import { AssetStore } from '@html-video/core';
import { detectAll, findAgent, spawnAgent } from '@html-video/runtime';

interface StudioHandle {
  url: string;
  port: number;
  close: () => void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveUiRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', '..', 'project-studio', 'public'),
    resolve(here, '..', 'public'),
    resolve(here, '..', '..', 'storyboard-ui', 'public'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0]!;
}

export async function startStudioServer(ctx: CliContext, port: number): Promise<StudioHandle> {
  const uiRoot = resolveUiRoot();

  const server = createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400);
        res.end();
        return;
      }
      const url = new URL(req.url, 'http://x');
      const m = req.method ?? 'GET';

      // ============== API ==============

      // List projects
      if (url.pathname === '/api/projects' && m === 'GET') {
        const list = await ctx.orchestrator.list();
        return json(res, 200, { projects: list });
      }

      // Create project
      if (url.pathname === '/api/projects' && m === 'POST') {
        const body = await readBody(req);
        const project = await ctx.orchestrator.create({
          name: (body.name as string) ?? 'Untitled',
          ...(body.intent !== undefined && { intent: body.intent as string }),
          preferences: (body.preferences as Record<string, unknown>) ?? {},
        });
        return json(res, 200, { project });
      }

      // Get / update / delete single project
      const projMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projMatch && projMatch[1]) {
        const id = projMatch[1];
        if (m === 'GET') {
          return json(res, 200, { project: await ctx.orchestrator.load(id) });
        }
        if (m === 'DELETE') {
          await ctx.orchestrator.remove(id);
          return json(res, 200, { ok: true });
        }
      }

      // List engines + templates
      if (url.pathname === '/api/templates' && m === 'GET') {
        return json(res, 200, {
          templates: ctx.templates.list().map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            engine: t.engine,
            category: t.category,
            tags: t.tags,
            best_for: t.best_for,
            inputs_schema: t.inputs.schema,
            inputs_examples: t.inputs.examples,
            license: t.license,
            preview: t.preview,
            output: t.output,
          })),
        });
      }

      // Add asset (multipart-style via JSON for v0.1: paths or inline content)
      const addAssetMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/assets$/);
      if (addAssetMatch && addAssetMatch[1] && m === 'POST') {
        const id = addAssetMatch[1];
        const ct = req.headers['content-type'] ?? '';
        let project;
        if (ct.startsWith('multipart/form-data')) {
          // Save uploaded file to /tmp then add
          const saved = await receiveMultipartFile(req, ct);
          project = await ctx.orchestrator.addFileAsset(id, saved.filePath);
        } else {
          const body = await readBody(req);
          if (body.kind === 'text') {
            project = await ctx.orchestrator.addInlineAsset(
              id,
              (body.content as string) ?? '',
              'text',
              body.caption as string | undefined,
            );
          } else if (body.kind === 'data') {
            project = await ctx.orchestrator.addInlineAsset(
              id,
              (body.content as string) ?? '',
              'data',
              body.caption as string | undefined,
            );
          } else if (body.kind === 'file' && body.path) {
            project = await ctx.orchestrator.addFileAsset(id, body.path as string);
          } else {
            return json(res, 400, { error: 'Provide kind=text|data|file with content/path' });
          }
        }
        return json(res, 200, { project });
      }

      // Remove asset
      const rmAssetMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/assets\/([^/]+)$/);
      if (rmAssetMatch && rmAssetMatch[1] && rmAssetMatch[2] && m === 'DELETE') {
        const project = await ctx.orchestrator.removeAsset(rmAssetMatch[1], rmAssetMatch[2]);
        return json(res, 200, { project });
      }

      // Set template
      const tplMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/template$/);
      if (tplMatch && tplMatch[1] && m === 'PUT') {
        const body = await readBody(req);
        const project = await ctx.orchestrator.setTemplate(tplMatch[1], body.template_id as string);
        // Auto-seed preview with the template's own example.html so the user sees
        // something immediately (before any chat-driven rewrite).
        const tmpl = ctx.templates.get(body.template_id as string);
        const exampleHtmlPath = join(tmpl.__dir!, tmpl.source_entry);
        if (existsSync(exampleHtmlPath)) {
          const html = await readFile(exampleHtmlPath, 'utf8');
          await ctx.orchestrator.writePreviewHtmlRaw(project.id, html);
        }
        return json(res, 200, { project: await ctx.orchestrator.load(project.id) });
      }

      // Set agent (runtime selection)
      const agentMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/agent$/);
      if (agentMatch && agentMatch[1] && m === 'PUT') {
        const body = await readBody(req);
        const project = await ctx.orchestrator.setAgent(
          agentMatch[1],
          (body.agent_id as string) || null,
        );
        return json(res, 200, { project });
      }

      // Set variables (whole bag)
      const varsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/variables$/);
      if (varsMatch && varsMatch[1] && m === 'PUT') {
        const body = await readBody(req);
        const project = await ctx.orchestrator.setVariables(
          varsMatch[1],
          (body.variables as Record<string, unknown>) ?? {},
        );
        return json(res, 200, { project });
      }

      // Render preview HTML
      const prevMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/preview$/);
      if (prevMatch && prevMatch[1] && m === 'POST') {
        const { project, htmlPath } = await ctx.orchestrator.renderPreviewHtml(prevMatch[1]);
        return json(res, 200, {
          project,
          preview_url: `/preview/${project.id}`,
          html_path: htmlPath,
        });
      }

      // Export MP4
      const expMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/export$/);
      if (expMatch && expMatch[1] && m === 'POST') {
        const { project, outputPath } = await ctx.orchestrator.exportMp4({
          projectId: expMatch[1],
        });
        return json(res, 200, { project, output_path: outputPath });
      }

      // Agents (detected on each call; cheap)
      if (url.pathname === '/api/agents' && m === 'GET') {
        const agents = await detectAll();
        return json(res, 200, { agents });
      }

      // Messages: GET history (in-memory only v0.2)
      const msgsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/messages$/);
      if (msgsMatch && msgsMatch[1] && m === 'GET') {
        const arr = MESSAGES.get(msgsMatch[1]) ?? [];
        return json(res, 200, { messages: arr });
      }

      // Messages: POST = send + stream agent reply via SSE
      // v0.3: agent emits a complete HTML document; we capture it, write to project,
      // and emit `preview_ready` so the frontend reloads the iframe.
      if (msgsMatch && msgsMatch[1] && m === 'POST') {
        const id = msgsMatch[1];
        const body = await readBody(req);
        const userText = (body.content as string) ?? '';
        if (!userText) return json(res, 400, { error: 'content required' });

        const project = await ctx.orchestrator.load(id);
        const tmpl = project.templateId ? ctx.templates.get(project.templateId) : null;
        if (!tmpl) {
          return json(res, 400, { error: 'pick a template first' });
        }

        const agentId = project.agentId ?? 'claude';
        const agentDef = findAgent(agentId);
        if (!agentDef) {
          return json(res, 400, { error: `agent "${agentId}" not registered` });
        }

        // Append user message to history
        const history = MESSAGES.get(id) ?? [];
        history.push({ role: 'user', content: userText, ts: Date.now() });
        MESSAGES.set(id, history);

        // Compose prompt: load template's example HTML so agent has the visual skeleton
        const exampleHtmlPath = join(tmpl.__dir!, tmpl.source_entry);
        const exampleHtml = existsSync(exampleHtmlPath)
          ? await readFile(exampleHtmlPath, 'utf8')
          : '';

        // Read prior assistant HTML if present (for iterative refinement)
        const projectDir = await ctx.projects.ensureDir(id);
        const priorHtmlPath = join(projectDir, 'preview.html');
        const priorHtml = existsSync(priorHtmlPath)
          ? await readFile(priorHtmlPath, 'utf8')
          : '';

        const fullPrompt = buildHtmlGenerationPrompt({
          tmpl,
          exampleHtml,
          priorHtml,
          history,
          userText,
        });

        // SSE response
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });

        let assistantText = '';
        const handle = spawnAgent({
          def: agentDef,
          prompt: fullPrompt,
          context: { cwd: projectDir },
          onEvent: (ev) => {
            if (ev.type === 'text') {
              assistantText += ev.chunk;
              res.write(`data: ${JSON.stringify(ev)}\n\n`);
            } else if (ev.type === 'error' || ev.type === 'message_end') {
              res.write(`data: ${JSON.stringify(ev)}\n\n`);
            }
          },
        });
        await handle.done;

        // Try to extract a full HTML document from assistant output
        const extracted = extractHtmlDocument(assistantText);
        if (extracted) {
          await ctx.orchestrator.writePreviewHtmlRaw(id, extracted);
          res.write(`data: ${JSON.stringify({ type: 'preview_ready', preview_url: `/preview/${id}` })}\n\n`);
        } else {
          res.write(
            `data: ${JSON.stringify({
              type: 'warning',
              message: 'Agent did not produce a full <!doctype html>...</html> document. Preview unchanged.',
            })}\n\n`,
          );
        }

        // Persist assistant message to history (text only — UI shows summary)
        history.push({
          role: 'assistant',
          agent: agentDef.id,
          content: extracted
            ? `Updated the HTML preview${assistantText.length > 0 ? '.' : '.'}`
            : assistantText,
          ts: Date.now(),
        });
        MESSAGES.set(id, history);
        res.end();
        return;
      }

      // ============== File serving ==============

      // Project preview HTML (and any sibling files like assets/)
      const previewServeMatch = url.pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
      if (previewServeMatch && previewServeMatch[1]) {
        const projId = previewServeMatch[1];
        const sub = previewServeMatch[2] ?? '/preview.html';
        const project = await ctx.orchestrator.load(projId);
        const baseDir = project.lastPreviewHtmlPath
          ? dirname(project.lastPreviewHtmlPath)
          : null;
        if (!baseDir) {
          res.writeHead(404);
          return res.end('Preview not rendered yet');
        }
        const filePath = sub === '/preview.html' || sub === '/'
          ? project.lastPreviewHtmlPath!
          : join(baseDir, sub);
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          return serveFile(filePath, res);
        }
        // Fallback: also try project assets/
        const projAssets = join(dirname(baseDir), 'assets', basename(sub));
        if (existsSync(projAssets)) return serveFile(projAssets, res);
        res.writeHead(404);
        return res.end('Not found');
      }

      // Asset direct serve (so iframe can load image_path etc)
      // /asset?path=<absolute-path>  — must be inside .html-video/projects
      if (url.pathname === '/asset' && m === 'GET') {
        const p = url.searchParams.get('path');
        if (!p) {
          res.writeHead(400);
          return res.end('missing ?path');
        }
        const safe = resolve(p);
        if (!safe.includes('/.html-video/projects/')) {
          res.writeHead(403);
          return res.end('forbidden');
        }
        if (existsSync(safe)) return serveFile(safe, res);
        res.writeHead(404);
        return res.end();
      }

      // Template poster (e.g. /template-asset/<id>/preview.png)
      const tplAssetMatch = url.pathname.match(/^\/template-asset\/([^/]+)\/(.+)$/);
      if (tplAssetMatch && tplAssetMatch[1] && tplAssetMatch[2]) {
        const t = ctx.templates.get(tplAssetMatch[1]);
        const filePath = join(t.__dir!, tplAssetMatch[2]);
        if (existsSync(filePath)) return serveFile(filePath, res);
        res.writeHead(404);
        return res.end();
      }

      // ============== Static UI ==============
      const path = url.pathname === '/' ? '/index.html' : url.pathname;
      const filePath = join(uiRoot, path);
      if (filePath.startsWith(uiRoot) && existsSync(filePath) && statSync(filePath).isFile()) {
        return serveFile(filePath, res);
      }

      res.writeHead(404);
      res.end('Not found');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: string }).code ?? 'unknown';
      json(res, 500, { error: msg, code });
    }
  });

  return new Promise((resolveFn) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolveFn({
        url: `http://127.0.0.1:${actualPort}`,
        port: actualPort,
        close: () => server.close(),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': MIME['.json']! });
  res.end(JSON.stringify(body));
}

async function serveFile(filePath: string, res: ServerResponse): Promise<void> {
  const ext = extname(filePath).toLowerCase();
  const buf = await readFile(filePath);
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  res.end(buf);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveFn, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolveFn(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Minimal multipart parser — only extracts the first file field.
 * v0.1 keeps it small; for production switch to formidable / busboy.
 */
async function receiveMultipartFile(
  req: IncomingMessage,
  contentType: string,
): Promise<{ filePath: string; filename: string }> {
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) throw new Error('No multipart boundary');
  const boundary = `--${boundaryMatch[1]}`;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const buf = Buffer.concat(chunks);
  const text = buf.toString('binary');
  const parts = text.split(boundary).slice(1, -1);
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    const body = part.slice(headerEnd + 4, part.length - 2); // strip trailing \r\n
    const fnMatch = headers.match(/filename="([^"]+)"/);
    if (!fnMatch || !fnMatch[1]) continue;
    const filename = fnMatch[1];
    const tmpPath = join(tmpdir(), `hv-upload-${randomUUID().slice(0, 8)}-${filename}`);
    await mkdir(dirname(tmpPath), { recursive: true });
    const data = Buffer.from(body, 'binary');
    const fs = await import('node:fs/promises');
    await fs.writeFile(tmpPath, data);
    return { filePath: tmpPath, filename };
  }
  throw new Error('No file field in multipart body');
}

// Keep TS aware that copyFile / AssetStore are used somewhere (they're indirectly via orchestrator)
void copyFile;
void AssetStore;

// ---------------------------------------------------------------------------
// In-memory message history (v0.2 — persistence in v0.3)
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  agent?: string;
  tool?: string;
  output?: unknown;
  ts: number;
}

const MESSAGES = new Map<string, ChatMessage[]>();

interface BuildPromptArgs {
  tmpl: import('@html-video/core').TemplateMetadata;
  exampleHtml: string;
  priorHtml: string;
  history: ChatMessage[];
  userText: string;
}

/**
 * v0.3 chat-to-HTML prompt.
 * Tells the agent to produce a single complete HTML document inside ```html ... ```
 * preserving the template's visual signature.
 */
function buildHtmlGenerationPrompt(args: BuildPromptArgs): string {
  const { tmpl, exampleHtml, priorHtml, history, userText } = args;
  const recentTurns = history.slice(-6); // last few turns for context

  const parts: string[] = [];

  parts.push(`# Role`);
  parts.push(`You are a Hyperframes video template engineer. The user wants a single self-contained HTML video that opens with animation and is ready to be recorded to MP4.`);
  parts.push('');

  parts.push(`# Template — visual skeleton (do not change the visual signature)`);
  parts.push(`Name: ${tmpl.name}`);
  parts.push(`Category: ${tmpl.category}`);
  parts.push(`Description: ${tmpl.description}`);
  parts.push('');
  parts.push('Reference example HTML (style, animation, layout to preserve):');
  parts.push('```html');
  parts.push(exampleHtml.slice(0, 12000));
  parts.push('```');
  parts.push('');

  if (priorHtml) {
    parts.push(`# Current preview HTML (the user is iterating on this)`);
    parts.push('```html');
    parts.push(priorHtml.slice(0, 12000));
    parts.push('```');
    parts.push('');
  }

  if (recentTurns.length > 1) {
    parts.push(`# Recent conversation`);
    for (const t of recentTurns.slice(0, -1)) {
      parts.push(`## ${t.role === 'user' ? 'User' : 'You'}`);
      parts.push(t.content);
    }
    parts.push('');
  }

  parts.push(`# User request`);
  parts.push(userText);
  parts.push('');

  parts.push(`# Output rules (STRICT)`);
  parts.push(`- Reply with **one** complete HTML document inside a single \`\`\`html\`\`\` code block.`);
  parts.push(`- Start with \`<!doctype html>\` and end with \`</html>\`.`);
  parts.push(`- Inline all CSS and JS (no external imports beyond the CDN scripts already in the example).`);
  parts.push(`- Preserve the template's visual signature (colors, animation timing, layout style) unless the user explicitly asks otherwise.`);
  parts.push(`- Replace placeholder text/data with the user's actual content.`);
  parts.push(`- Do **not** include any explanation outside the code block. The user will see the HTML rendered live; they don't need a written summary.`);

  return parts.join('\n');
}

/**
 * Extract a full HTML document from agent output.
 * Tries (1) `\`\`\`html ... \`\`\`` block, (2) bare `<!doctype html>...</html>`.
 */
function extractHtmlDocument(text: string): string | null {
  const fence = /```html\s*\n([\s\S]*?)```/i.exec(text);
  if (fence && fence[1]) {
    const html = fence[1].trim();
    if (/<\/html>/i.test(html)) return html;
  }
  const bare = /<!doctype html[\s\S]*?<\/html>/i.exec(text);
  if (bare) return bare[0];
  return null;
}
