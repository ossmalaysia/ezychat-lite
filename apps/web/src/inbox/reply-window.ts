import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_INBOX_CAPABILITIES,
  LINKED_PHONE,
  type Inbox,
  type InboxCapabilities,
} from '@ezychat/shared';
import { useInboxes } from '../api/queries';

const HOUR_MS = 3_600_000;

/**
 * What an inbox's connection can do. An older server sends no capabilities: such an inbox is a
 * linked phone (QR scan, no reply window).
 */
export function inboxCapabilities(inbox: Partial<Pick<Inbox, 'capabilities'>>): InboxCapabilities {
  return inbox.capabilities ?? DEFAULT_INBOX_CAPABILITIES;
}

/** The inbox's connection type; an older server sends none (linked phone). */
export function inboxTypeOf(inbox: Partial<Pick<Inbox, 'type'>>): string {
  return inbox.type ?? LINKED_PHONE;
}

/**
 * Milliseconds left in a chat's reply window: `null` when its inbox has no window (linked phone),
 * `0` once it has closed or before the customer ever wrote (only a template may be sent then).
 */
export function replyWindowLeft(
  lastInboundAt: number | null | undefined,
  windowHours: number | null | undefined,
  now: number,
): number | null {
  if (windowHours == null) return null;
  if (lastInboundAt == null) return 0;
  return Math.max(0, lastInboundAt + windowHours * HOUR_MS - now);
}

/** True in the last hour of an open window (the note turns to the warning tone). */
export function replyWindowEnding(left: number): boolean {
  return left > 0 && left < HOUR_MS;
}

/** The current time, updated every `intervalMs` (the window labels tick each minute). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** The reply window hours of a chat's inbox (removed inboxes included), or null without one. */
export function useReplyWindowHours(): (inboxId: number) => number | null {
  const { data } = useInboxes();
  const all = data?.inboxes;
  const byId = useMemo(
    () => new Map((all ?? []).map((i) => [i.id, inboxCapabilities(i).replyWindowHours])),
    [all],
  );
  return useCallback((inboxId: number) => byId.get(inboxId) ?? null, [byId]);
}

/**
 * Whether a chat's inbox can tag group members (@mention). Its connection must say so
 * (`capabilities.mentions`); an inbox not listed yet cannot.
 */
export function useInboxCanTag(): (inboxId: number) => boolean {
  const { data } = useInboxes();
  const all = data?.inboxes;
  const byId = useMemo(
    () => new Map((all ?? []).map((i) => [i.id, inboxCapabilities(i).mentions === true])),
    [all],
  );
  return useCallback((inboxId: number) => byId.get(inboxId) ?? false, [byId]);
}

/** Longest delay `setTimeout` accepts. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Whether a chat's reply window is closed (`null`: its inbox has no window). Re-renders only when
 * the window closes, not every minute, so a whole conversation is not redrawn while it ticks.
 */
export function useWindowClosed(
  lastInboundAt: number | null | undefined,
  windowHours: number | null | undefined,
): boolean | null {
  const [now, setNow] = useState(() => Date.now());
  const left = replyWindowLeft(lastInboundAt, windowHours, now);
  useEffect(() => {
    if (left === null || left === 0) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(left + 50, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [left]);
  // A customer's new message moves lastInboundAt: measure against the current time again.
  useEffect(() => setNow(Date.now()), [lastInboundAt, windowHours]);
  return left === null ? null : left === 0;
}
