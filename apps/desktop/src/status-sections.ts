// Edition-provided sections on the Status & Service page. Pure: must not import 'electron'.
//
// An edition (e.g. EzyChat Enterprise licensing) adds cards above "App updates" by passing
// `statusSections` to defineProduct. A provider returns a declarative model; the status page renders
// it with the existing card styles (no edition HTML or script). Actions go back through one guarded
// IPC channel; the renderer names only a section, a button and the values of the section's fields.
// Link and mail buttons are opened by the main process from the main-side model, never from a
// renderer-supplied address.

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';
export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

export interface StatusSectionField {
  id: string;
  label: string;
  type: 'text' | 'email' | 'code';
  value?: string;
  placeholder?: string;
  hint?: string;
}

export interface StatusSectionButton {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
  /** 'action' (default) calls onAction; 'mailto' / 'link' open `href` outside the app. */
  kind?: 'action' | 'mailto' | 'link';
  href?: string;
}

export interface StatusSectionModel {
  id: string;
  title: string;
  badge?: { text: string; tone: StatusTone };
  headline?: string;
  message?: string;
  notice?: { tone: NoticeTone; text: string };
  steps?: string[];
  rows?: { label: string; value: string }[];
  fields?: StatusSectionField[];
  buttons?: StatusSectionButton[];
  details?: { label: string; value: string }[];
}

export interface StatusSectionContext {
  /** Loopback inbox server URL, or null while no server answers. */
  serverUrl: string | null;
}

export interface StatusSectionProvider {
  id: string;
  /** Lower first; providers without an order follow, in definition order. */
  order?: number;
  /** Poll interval in ms (default 30 s, at least 5 s). */
  refreshMs?: number;
  getModel(ctx: StatusSectionContext): Promise<StatusSectionModel | null>;
  onAction(
    actionId: string,
    values: Record<string, string>,
    ctx: StatusSectionContext,
  ): Promise<{ ok: boolean; message?: string }>;
}

/** Sent to the status page: one entry per provider that currently shows a section. */
export interface StatusSectionView {
  provider: string;
  model: StatusSectionModel;
}

export interface StatusSectionResult {
  ok: boolean;
  message?: string;
}

export const DEFAULT_REFRESH_MS = 30_000;
const MIN_REFRESH_MS = 5_000;
const ID = /^[a-z][a-z0-9_-]{0,63}$/i;
const MAX_TEXT = 2_000;
const MAX_SHORT = 200;
const MAX_VALUE = 500;
const MAX_ITEMS = 20;
const STATUS_TONES = new Set<StatusTone>(['neutral', 'success', 'warning', 'danger']);
const NOTICE_TONES = new Set<NoticeTone>(['info', 'success', 'warning', 'danger']);
const FIELD_TYPES = new Set(['text', 'email', 'code']);

/** Only https: and mailto: addresses leave the app; nothing else (file:, javascript:, http:, …). */
export function isAllowedExternalHref(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_000) return false;
  try {
    const url = new URL(value);
    if (url.protocol === 'mailto:') return url.pathname.length > 0;
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;
}

function list<T>(value: unknown, map: (item: unknown) => T | null): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: T[] = [];
  for (const item of value.slice(0, MAX_ITEMS)) {
    const mapped = map(item);
    if (mapped) out.push(mapped);
  }
  return out.length ? out : undefined;
}

function obj(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pairs(value: unknown): { label: string; value: string }[] | undefined {
  return list(value, (item) => {
    const o = obj(item);
    const label = text(o?.label, MAX_SHORT);
    const v = typeof o?.value === 'string' ? o.value.slice(0, MAX_TEXT) : undefined;
    return label && v !== undefined ? { label, value: v } : null;
  });
}

/**
 * Copies a provider model into a plain, bounded, well-typed object (or null when unusable).
 * Unknown tones/types are dropped, ids must be simple, and link buttons need an allowed address.
 */
export function sanitizeModel(value: unknown): StatusSectionModel | null {
  const o = obj(value);
  if (!o || typeof o.id !== 'string' || !ID.test(o.id)) return null;
  const title = text(o.title, MAX_SHORT);
  if (!title) return null;
  const model: StatusSectionModel = { id: o.id, title };
  const badge = obj(o.badge);
  const badgeText = text(badge?.text, MAX_SHORT);
  if (badgeText && STATUS_TONES.has(badge!.tone as StatusTone))
    model.badge = { text: badgeText, tone: badge!.tone as StatusTone };
  const headline = text(o.headline, MAX_SHORT);
  if (headline) model.headline = headline;
  const message = text(o.message, MAX_TEXT);
  if (message) model.message = message;
  const notice = obj(o.notice);
  const noticeText = text(notice?.text, MAX_TEXT);
  if (noticeText && NOTICE_TONES.has(notice!.tone as NoticeTone))
    model.notice = { tone: notice!.tone as NoticeTone, text: noticeText };
  const steps = list(o.steps, (s) => text(s, MAX_TEXT) ?? null);
  if (steps) model.steps = steps;
  const rows = pairs(o.rows);
  if (rows) model.rows = rows;
  const seen = new Set<string>();
  const fields = list(o.fields, (item) => {
    const f = obj(item);
    const label = text(f?.label, MAX_SHORT);
    if (!f || typeof f.id !== 'string' || !ID.test(f.id) || seen.has(f.id) || !label) return null;
    if (!FIELD_TYPES.has(f.type as string)) return null;
    seen.add(f.id);
    const field: StatusSectionField = {
      id: f.id,
      label,
      type: f.type as StatusSectionField['type'],
    };
    if (typeof f.value === 'string') field.value = f.value.slice(0, MAX_VALUE);
    const placeholder = text(f.placeholder, MAX_SHORT);
    if (placeholder) field.placeholder = placeholder;
    const hint = text(f.hint, MAX_TEXT);
    if (hint) field.hint = hint;
    return field;
  });
  if (fields) model.fields = fields;
  const buttonIds = new Set<string>();
  const buttons = list(o.buttons, (item) => {
    const b = obj(item);
    const label = text(b?.label, MAX_SHORT);
    if (!b || typeof b.id !== 'string' || !ID.test(b.id) || buttonIds.has(b.id) || !label)
      return null;
    const kind = b.kind === undefined ? 'action' : b.kind;
    if (kind !== 'action' && kind !== 'mailto' && kind !== 'link') return null;
    const button: StatusSectionButton = { id: b.id, label, kind };
    if (kind !== 'action') {
      if (!isAllowedExternalHref(b.href)) return null;
      const scheme = new URL(b.href).protocol;
      if ((kind === 'mailto') !== (scheme === 'mailto:')) return null;
      button.href = b.href;
    }
    if (b.primary === true) button.primary = true;
    if (b.danger === true) button.danger = true;
    buttonIds.add(b.id);
    return button;
  });
  if (buttons) model.buttons = buttons;
  const details = pairs(o.details);
  if (details) model.details = details;
  return model;
}

/** Providers in display order: by `order`, then definition order. Duplicate ids keep the first. */
export function orderProviders(
  providers: readonly StatusSectionProvider[],
): StatusSectionProvider[] {
  const seen = new Set<string>();
  return providers
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    })
    .sort(
      (a, b) =>
        (a.p.order ?? Number.MAX_SAFE_INTEGER) - (b.p.order ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index,
    )
    .map(({ p }) => p);
}

/** Validates provider definitions (used by defineProduct). Returns a frozen copy of the list. */
export function checkStatusSections(value: unknown): readonly StatusSectionProvider[] {
  if (!Array.isArray(value)) throw new Error('Invalid product statusSections: expected an array');
  const ids = new Set<string>();
  for (const [i, p] of value.entries()) {
    const o = obj(p);
    if (!o || typeof o.id !== 'string' || !ID.test(o.id))
      throw new Error(`Invalid product statusSections[${i}]: id`);
    if (ids.has(o.id)) throw new Error(`Invalid product statusSections: duplicate id ${o.id}`);
    ids.add(o.id);
    if (typeof o.getModel !== 'function' || typeof o.onAction !== 'function')
      throw new Error(`Invalid product statusSections[${i}]: getModel and onAction are required`);
    if (o.order !== undefined && !Number.isFinite(o.order))
      throw new Error(`Invalid product statusSections[${i}]: order`);
    if (
      o.refreshMs !== undefined &&
      (!Number.isFinite(o.refreshMs) || (o.refreshMs as number) <= 0)
    )
      throw new Error(`Invalid product statusSections[${i}]: refreshMs`);
  }
  return Object.freeze([...(value as StatusSectionProvider[])]);
}

export interface StatusSectionsHostOptions {
  providers: readonly StatusSectionProvider[];
  context: () => StatusSectionContext;
  onChanged?: (views: StatusSectionView[]) => void;
  /** Opens a checked https:/mailto: address (shell.openExternal in the app). */
  openExternal: (href: string) => Promise<void> | void;
  log?: (fields: Record<string, unknown>) => void;
  setTimer?: (fn: () => void, ms: number) => { cancel(): void };
}

export interface SectionActionRequest {
  sectionId: string;
  buttonId: string;
  values: Record<string, string>;
}

/** Parses the single renderer argument of the action channel; throws on anything unexpected. */
export function parseActionRequest(value: unknown): SectionActionRequest {
  const o = obj(value);
  if (!o || Object.keys(o).some((k) => !['sectionId', 'buttonId', 'values'].includes(k)))
    throw new Error('Invalid status request');
  if (typeof o.sectionId !== 'string' || !ID.test(o.sectionId))
    throw new Error('Invalid status request');
  if (typeof o.buttonId !== 'string' || !ID.test(o.buttonId))
    throw new Error('Invalid status request');
  const values: Record<string, string> = {};
  const raw = o.values === undefined ? {} : obj(o.values);
  if (!raw) throw new Error('Invalid status request');
  const entries = Object.entries(raw);
  if (entries.length > MAX_ITEMS) throw new Error('Invalid status request');
  for (const [key, v] of entries) {
    if (!ID.test(key) || typeof v !== 'string' || v.length > MAX_VALUE)
      throw new Error('Invalid status request');
    values[key] = v;
  }
  return { sectionId: o.sectionId, buttonId: o.buttonId, values };
}

function defaultTimer(fn: () => void, ms: number): { cancel(): void } {
  const t = setTimeout(fn, ms);
  t.unref?.();
  return { cancel: () => clearTimeout(t) };
}

interface Slot {
  provider: StatusSectionProvider;
  model: StatusSectionModel | null;
  timer: { cancel(): void } | null;
  /** increments on each refresh so a slow, older answer never replaces a newer one */
  generation: number;
  busy: boolean;
}

/** Main-process owner of edition sections: polls providers and runs their actions. */
export class StatusSectionsHost {
  private readonly slots: Slot[];
  private running = false;
  private readonly setTimer: NonNullable<StatusSectionsHostOptions['setTimer']>;

  constructor(private readonly options: StatusSectionsHostOptions) {
    this.slots = orderProviders(options.providers).map((provider) => ({
      provider,
      model: null,
      timer: null,
      generation: 0,
      busy: false,
    }));
    this.setTimer = options.setTimer ?? defaultTimer;
  }

  get empty(): boolean {
    return this.slots.length === 0;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const slot of this.slots) void this.refresh(slot);
  }

  stop(): void {
    this.running = false;
    for (const slot of this.slots) {
      slot.timer?.cancel();
      slot.timer = null;
      slot.generation++;
    }
  }

  /** Refresh every provider now (e.g. after the server came up). */
  refreshAll(): Promise<void> {
    return Promise.all(this.slots.map((slot) => this.refresh(slot))).then(() => undefined);
  }

  views(): StatusSectionView[] {
    return this.slots
      .filter((s) => s.model)
      .map((s) => ({ provider: s.provider.id, model: structuredClone(s.model!) }));
  }

  async runAction(request: SectionActionRequest): Promise<StatusSectionResult> {
    const slot = this.slots.find((s) => s.model?.id === request.sectionId);
    const button = slot?.model?.buttons?.find((b) => b.id === request.buttonId);
    if (!slot || !button) return { ok: false };
    if (button.kind === 'mailto' || button.kind === 'link') {
      // The address comes from the main-side model, already checked by sanitizeModel.
      if (!isAllowedExternalHref(button.href)) return { ok: false };
      await this.options.openExternal(button.href);
      return { ok: true };
    }
    if (slot.busy) return { ok: false };
    // Only values of fields the section currently shows reach the provider.
    const allowed = new Set((slot.model!.fields ?? []).map((f) => f.id));
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.values)) {
      if (allowed.has(key)) values[key] = value;
    }
    slot.busy = true;
    const startedAt = Date.now();
    let result: StatusSectionResult;
    try {
      const raw = await slot.provider.onAction(button.id, values, this.options.context());
      result = { ok: raw?.ok === true };
      const message = text(raw?.message, MAX_TEXT);
      if (message) result.message = message;
    } catch {
      result = { ok: false };
    } finally {
      slot.busy = false;
    }
    this.options.log?.({
      mod: 'desktop-sections',
      event: 'action',
      provider: slot.provider.id,
      action: button.id,
      ok: result.ok,
      ms: Date.now() - startedAt,
    });
    await this.refresh(slot);
    return result;
  }

  private async refresh(slot: Slot): Promise<void> {
    slot.timer?.cancel();
    slot.timer = null;
    const generation = ++slot.generation;
    let model: StatusSectionModel | null = slot.model;
    try {
      model = sanitizeModel(await slot.provider.getModel(this.options.context()));
    } catch (error) {
      // Keep the last model: a provider that briefly fails must not make its card flicker away.
      this.options.log?.({
        mod: 'desktop-sections',
        event: 'model_failed',
        provider: slot.provider.id,
        error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      });
    }
    if (generation !== slot.generation) return;
    const changed = JSON.stringify(model) !== JSON.stringify(slot.model);
    slot.model = model;
    if (this.running) {
      const ms = Math.max(MIN_REFRESH_MS, slot.provider.refreshMs ?? DEFAULT_REFRESH_MS);
      slot.timer = this.setTimer(() => void this.refresh(slot), ms);
    }
    if (changed) this.options.onChanged?.(this.views());
  }
}
