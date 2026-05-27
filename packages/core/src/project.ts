/**
 * Project orchestrator: 单模板单视频工作流（RFC-05）。
 * - createProject
 * - addAsset / removeAsset
 * - setTemplate / setVariable / setVariables
 * - renderPreviewHtml: 调 EngineAdapter.renderToHtml() → HTML for iframe
 * - exportMp4: 调 EngineAdapter.render() → MP4 file
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  Asset,
  Project,
  ProjectStatus,
  TemplateMetadata,
} from './types/index.js';
import { HtmlVideoError } from './errors.js';
import type { AssetStore } from './asset-store.js';
import type { EngineRegistry, ProjectStore, TemplateRegistry } from './registry.js';

export interface CreateProjectInput {
  name: string;
  intent?: string;
  preferences?: Project['preferences'];
}

export interface ProjectOrchestratorDeps {
  projectRoot: string;
  engines: EngineRegistry;
  templates: TemplateRegistry;
  projects: ProjectStore;
  assets: AssetStore;
}

export class ProjectOrchestrator {
  constructor(private readonly deps: ProjectOrchestratorDeps) {}

  // ---------------- CRUD ----------------

  async create(input: CreateProjectInput): Promise<Project> {
    const id = `proj_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const project: Project = {
      id,
      name: input.name,
      ...(input.intent !== undefined && { intent: input.intent }),
      assets: [],
      templateId: null,
      variables: {},
      preferences: input.preferences ?? {},
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.projects.save(project);
    return project;
  }

  async list(): Promise<Project[]> {
    return this.deps.projects.list();
  }

  async load(id: string): Promise<Project> {
    return this.deps.projects.load(id);
  }

  async remove(id: string): Promise<void> {
    return this.deps.projects.remove(id);
  }

  // ---------------- Asset ops ----------------

  async addFileAsset(projectId: string, sourcePath: string, userCaption?: string): Promise<Project> {
    await this.deps.projects.ensureDir(projectId);
    const project = await this.deps.projects.load(projectId);
    const asset = await this.deps.assets.addFileAsset(projectId, sourcePath, [], userCaption);
    if (!project.assets.find((a) => a.id === asset.id)) {
      project.assets.push(asset);
    }
    project.status = downgradeStatus(project.status, 'draft');
    await this.deps.projects.save(project);
    return project;
  }

  async addInlineAsset(
    projectId: string,
    content: string,
    type: 'text' | 'data',
    userCaption?: string,
  ): Promise<Project> {
    await this.deps.projects.ensureDir(projectId);
    const project = await this.deps.projects.load(projectId);
    const asset = await this.deps.assets.addInlineAsset(projectId, content, type, [], userCaption);
    if (!project.assets.find((a) => a.id === asset.id)) {
      project.assets.push(asset);
    }
    project.status = downgradeStatus(project.status, 'draft');
    await this.deps.projects.save(project);
    return project;
  }

  async removeAsset(projectId: string, assetId: string): Promise<Project> {
    const project = await this.deps.projects.load(projectId);
    project.assets = project.assets.filter((a) => a.id !== assetId);
    await this.deps.projects.save(project);
    return project;
  }

  // ---------------- Template / variables ----------------

  async setTemplate(projectId: string, templateId: string | null): Promise<Project> {
    const project = await this.deps.projects.load(projectId);
    if (templateId !== null && !this.deps.templates.has(templateId)) {
      throw new HtmlVideoError('template-not-found', `Template ${templateId} not found`);
    }
    project.templateId = templateId;
    // v0.3: variables are no longer the user-facing surface. Reset on every
    // template change so old keys don't bleed through into the new context.
    project.variables = {};
    project.status = downgradeStatus(project.status, 'draft');
    await this.deps.projects.save(project);
    return project;
  }

  async setVariables(projectId: string, vars: Record<string, unknown>): Promise<Project> {
    const project = await this.deps.projects.load(projectId);
    project.variables = vars;
    project.status = downgradeStatus(project.status, 'draft');
    await this.deps.projects.save(project);
    return project;
  }

  async setVariable(projectId: string, key: string, value: unknown): Promise<Project> {
    const project = await this.deps.projects.load(projectId);
    project.variables = { ...project.variables, [key]: value };
    project.status = downgradeStatus(project.status, 'draft');
    await this.deps.projects.save(project);
    return project;
  }

  async setAgent(projectId: string, agentId: string | null): Promise<Project> {
    const project = await this.deps.projects.load(projectId);
    project.agentId = agentId;
    await this.deps.projects.save(project);
    return project;
  }

  /**
   * v0.3 chat-to-HTML: write raw HTML produced by an agent into the project's preview slot.
   */
  async writePreviewHtmlRaw(projectId: string, html: string): Promise<{ project: Project; htmlPath: string }> {
    const project = await this.deps.projects.load(projectId);
    const projectDir = await this.deps.projects.ensureDir(projectId);
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const htmlPath = join(projectDir, 'preview.html');
    await writeFile(htmlPath, html, 'utf8');
    project.lastPreviewHtmlPath = htmlPath;
    if (project.status === 'draft') project.status = 'previewed';
    await this.deps.projects.save(project);
    return { project, htmlPath };
  }

  // ---------------- Render: preview HTML / export MP4 ----------------

  async renderPreviewHtml(projectId: string): Promise<{ project: Project; htmlPath: string }> {
    const project = await this.deps.projects.load(projectId);
    if (!project.templateId) {
      throw new HtmlVideoError('invalid-input', 'Project has no template selected');
    }
    const tmpl = this.deps.templates.get(project.templateId);
    const adapter = this.deps.engines.get(tmpl.engine);
    if (!adapter.renderToHtml) {
      throw new HtmlVideoError(
        'render-failed',
        `Engine ${tmpl.engine} adapter does not support renderToHtml()`,
      );
    }
    const projectDir = await this.deps.projects.ensureDir(projectId);

    const out = await adapter.renderToHtml(
      {
        template: templateRefFromMeta(tmpl),
        variables: project.variables,
        config: {
          format: 'mp4',
          resolution: project.preferences.resolution ?? { width: 1920, height: 1080 },
          fps: project.preferences.fps ?? 60,
          duration: 'auto',
          outputPath: join(projectDir, 'output.mp4'),
        },
      },
      { workDir: projectDir },
    );

    project.lastPreviewHtmlPath = out.htmlPath;
    project.lastPreviewPosterPath = out.posterPath;
    if (project.status === 'draft') project.status = 'previewed';
    await this.deps.projects.save(project);
    return { project, htmlPath: out.htmlPath };
  }

  async exportMp4(args: {
    projectId: string;
    outputPath?: string;
    onProgress?: (pct: number, stage: string) => void;
    signal?: AbortSignal;
  }): Promise<{ project: Project; outputPath: string }> {
    const project = await this.deps.projects.load(args.projectId);
    if (!project.templateId) {
      throw new HtmlVideoError('invalid-input', 'Project has no template selected');
    }
    const tmpl = this.deps.templates.get(project.templateId);
    const adapter = this.deps.engines.get(tmpl.engine);
    const projectDir = await this.deps.projects.ensureDir(project.id);
    const outputPath = args.outputPath ?? join(projectDir, 'output.mp4');

    await adapter.render(
      {
        template: templateRefFromMeta(tmpl),
        variables: project.variables,
        config: {
          format: 'mp4',
          resolution: project.preferences.resolution ?? { width: 1920, height: 1080 },
          fps: project.preferences.fps ?? 60,
          duration: 'auto',
          outputPath,
        },
      },
      {
        workDir: projectDir,
        ...(args.onProgress !== undefined && { onProgress: args.onProgress }),
        ...(args.signal !== undefined && { signal: args.signal }),
      },
    );
    project.lastOutputMp4Path = outputPath;
    project.status = 'rendered';
    await this.deps.projects.save(project);
    return { project, outputPath };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function templateRefFromMeta(meta: TemplateMetadata) {
  if (!meta.__dir) {
    throw new HtmlVideoError(
      'template-invalid',
      `Template ${meta.id} has no __dir set; was it loaded via TemplateRegistry?`,
    );
  }
  return {
    id: meta.id,
    engine: meta.engine,
    sourcePath: join(meta.__dir, meta.source_entry),
  };
}

function downgradeStatus(current: ProjectStatus, target: ProjectStatus): ProjectStatus {
  // After any modification, status should not be more advanced than 'draft'/given target.
  // 'rendered' / 'previewed' get demoted back to 'draft' on any meaningful change.
  if (target === 'draft') return 'draft';
  return current;
}

