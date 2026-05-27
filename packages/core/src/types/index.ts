/**
 * @html-video/core type definitions
 * Implements RFC-01 (engine adapter) + RFC-02 (template metadata) + RFC-05 (project-centric workflow).
 * See research/2026-05-{26,27}-spec-{01,02,05}-*.md.
 *
 * NOTE: Storyboard / Scene types from RFC-04 were removed in v0.1
 * after Joey's product clarification — see RFC-05.
 */

// ============================================================================
// RFC-01: Engine Adapter
// ============================================================================

export type EngineId = string;

export type Paradigm =
  | 'html-css-gsap'
  | 'react-tsx'
  | 'ts-generator'
  | 'json-scene'
  | 'imperative-canvas';

export type OutputFormat = 'mp4' | 'webm' | 'webm-alpha' | 'gif' | 'png-sequence' | 'apng';

export type RenderTarget = 'local-chromium' | 'local-canvas' | 'lambda' | 'cloud-run';

export type LicensingTier = 'free-osi' | 'commercial-restricted' | 'unknown';

export interface RenderSpeedHint {
  resolution: string;
  durationSec: number;
  fps: number;
  estimatedRenderSec: number;
}

export interface EngineCapabilities {
  paradigms: Paradigm[];
  outputFormats: OutputFormat[];
  maxResolution: { width: number; height: number };
  alpha: boolean;
  audio: 'none' | 'single' | 'multi';
  subtitles: ('none' | 'burn-in' | 'sidecar')[];
  renderTarget: RenderTarget[];
  licensing: LicensingTier;
  renderSpeedHint?: RenderSpeedHint;
  bestFor: string[];
  weaknesses: string[];
}

export interface ValidationError {
  code: string;
  message: string;
  fix?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface RenderConfig {
  format: OutputFormat;
  resolution: { width: number; height: number };
  fps: number;
  duration: number | 'auto';
  outputPath: string;
  alpha?: boolean;
  quality?: number | 'low' | 'medium' | 'high' | 'lossless';
  audio?: { path: string; volumeDb?: number }[];
}

export interface RenderInput {
  template: TemplateRef;
  variables: Record<string, unknown>;
  config: RenderConfig;
}

export interface RenderContext {
  workDir: string;
  onProgress?: (pct: number, stage: string) => void;
  signal?: AbortSignal;
  env?: Record<string, string>;
}

export interface RenderOutput {
  outputPath: string;
  meta: {
    durationSec: number;
    fileSizeBytes: number;
    actualResolution: { width: number; height: number };
    fps: number;
    renderedFrames: number;
    renderWallClockSec: number;
    engineVersion: string;
  };
  diagnostics: string[];
}

export interface PreviewContext {
  workDir: string;
  hostname?: string;
  port?: number;
}

export interface PreviewHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface NativeTemplateRef {
  nativeId: string;
  path: string;
  hints?: { name?: string; description?: string; bestFor?: string[] };
}

export interface HtmlSceneOutput {
  htmlPath: string;
  referencedAssets: { assetId: string; usagePath: string }[];
  posterPath: string;
  durationSec: number;
}

export interface EngineAdapter {
  id: EngineId;
  name: string;
  upstreamVersion: string;
  capabilities: EngineCapabilities;

  validate(template: TemplateRef): ValidationResult;
  render(input: RenderInput, ctx: RenderContext): Promise<RenderOutput>;
  preview?(template: TemplateRef, ctx: PreviewContext): Promise<PreviewHandle>;
  renderToHtml?(input: RenderInput, ctx: RenderContext): Promise<HtmlSceneOutput>;
  listNativeTemplates?(): Promise<NativeTemplateRef[]>;
}

// ============================================================================
// RFC-02: Template Metadata
// ============================================================================

export type TemplateCategory =
  | 'data-viz'
  | 'social-shorts'
  | 'product-demo'
  | 'explainer'
  | 'marketing'
  | 'intro-outro'
  | 'ambient'
  | 'documentary'
  | 'presentation'
  | 'transition';

export interface OutputCapabilities {
  formats: OutputFormat[];
  default_format: OutputFormat;
  resolution: {
    default: { width: number; height: number };
    supported_aspects: string[];
  };
  fps: { default: number; supported: number[] };
  duration: {
    type: 'variable' | 'fixed';
    min_sec: number;
    max_sec: number;
  };
  alpha: boolean;
  audio: { supported: boolean; expected_inputs?: string[] };
}

export interface LicenseInfo {
  spdx: string;
  attribution_required: boolean;
  redistribution_allowed: boolean;
  commercial_use: boolean;
  notes?: string | null;
}

export interface AssetAttribution {
  name: string;
  license: string;
  author?: string;
  url?: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  notes: string;
}

export interface PerformanceRef {
  duration_sec: number;
  render_wall_clock_sec: number;
  machine: string;
}

export interface TemplateMetadata {
  spec_version: 1;
  id: string;
  name: string;
  description: string;
  engine: EngineId;
  engine_version: string;
  source_entry: string;
  category: TemplateCategory;
  subcategory?: string;
  tags: string[];
  best_for: string[];
  not_for?: string[];
  output: OutputCapabilities;
  inputs: { schema: object; examples: object[] };
  license: LicenseInfo;
  assets_attribution?: AssetAttribution[];
  author: { name: string; url?: string; contact?: string };
  maintainers?: { github: string }[];
  contributing?: { url: string };
  version: string;
  changelog?: ChangelogEntry[];
  preview: { poster: string; loop?: string; thumbnail?: string };
  performance?: { reference_render: PerformanceRef };
  share_optimized_for?: string[];
  /** Internal: filesystem location of the template directory (set by registry) */
  __dir?: string;
}

export interface TemplateRef {
  id: string;
  engine: EngineId;
  sourcePath: string;
  variables?: Record<string, unknown>;
}

// ============================================================================
// RFC-05: Project-centric workflow
// ============================================================================

export type AssetType = 'image' | 'text' | 'data' | 'audio' | 'video' | 'reference-link';

export interface Asset {
  id: string;
  type: AssetType;
  path?: string;
  content?: string;
  metadata: {
    filename?: string;
    mimeType?: string;
    sizeBytes?: number;
    width?: number;
    height?: number;
    durationSec?: number;
    userCaption?: string;
  };
  userTags: string[];
}

export interface UserPreferences {
  aspect?: string;
  durationTargetSec?: number;
  format?: 'mp4' | 'webm';
  resolution?: { width: number; height: number };
  fps?: number;
  mood?: string;
  brandColors?: string[];
  fontFamilies?: string[];
  language?: string;
  commercial?: boolean;
}

export type ProjectStatus = 'draft' | 'previewed' | 'rendered';

export interface Project {
  id: string;
  name: string;
  intent?: string;
  assets: Asset[];
  templateId: string | null;
  /** Agent runtime to use (detected agent id, e.g. "claude" / "cursor-agent"). null = default first available */
  agentId?: string | null;
  /**
   * Free-form variables (RFC-02 inputs.schema compatible).
   * v0.3+: deprecated as the user-facing primary surface — agents now produce HTML directly.
   * Kept for adapter render() backward compatibility (engine still expects vars).
   */
  variables: Record<string, unknown>;
  preferences: UserPreferences;
  status: ProjectStatus;
  /** Path to the latest agent-generated HTML (v0.3 chat-to-HTML pipeline) */
  lastPreviewHtmlPath?: string;
  lastPreviewPosterPath?: string;
  lastOutputMp4Path?: string;
  createdAt: string;
  updatedAt: string;
}
