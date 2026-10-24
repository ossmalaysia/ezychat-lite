/** External links used for attribution and support across the app. */
export const ANCHOR_SPRINT_URL = 'https://www.anchorsprint.com';
export const EZYCHAT_WEBSITE_URL = 'https://ezychat.ai/';
export const GITHUB_REPO_URL = 'https://github.com/ossmalaysia/ezychat-lite';
export const GITHUB_ISSUES_URL = 'https://github.com/ossmalaysia/ezychat-lite/issues/new/choose';
/** Feedback and feature requests on the EzyChat website, one page per app language. */
const FEEDBACK_PAGE_EN = 'https://ezychat.ai/feedback';
const FEEDBACK_PAGE: Partial<Record<string, string>> = {
  ms: 'https://ezychat.ai/ms/feedback',
  'zh-CN': 'https://ezychat.ai/zh/feedback',
};

/** The website feedback form in the app's language, with the running version filled in. */
export function feedbackUrl(locale: string, version: string | null): string {
  const page = FEEDBACK_PAGE[locale] ?? FEEDBACK_PAGE_EN;
  return version ? `${page}?v=${encodeURIComponent(version)}` : page;
}
/** Contact Anchor Sprint for custom features. */
export const CUSTOM_FEATURE_URL = 'https://www.anchorsprint.com';

/**
 * The outside links the UI shows (About, Report an issue, release notes, feedback, support).
 * Another product build overrides them through `createInboxApp({ links })`; `null` hides a link.
 */
export interface AppLinks {
  /** Product website (About, and the share link when there is no source code link). */
  website: string;
  /** "Report an issue" page; when null, an email link to `supportEmail` is shown instead. */
  reportIssue: string | null;
  /** Public source code ("View on GitHub" in About). */
  sourceCode: string | null;
  /**
   * Release notes for one version, shown by the desktop update panel. Lite opens its GitHub
   * release through the desktop bridge; another value is opened as a plain link.
   */
  releaseNotes: ((version: string) => string | null) | null;
  /** The feedback / feature request form in the app's language. */
  feedback: (locale: string, version: string | null) => string;
  /** Support email address (mailto link where there is no report-issue page). */
  supportEmail: string | null;
  /** "Upgrade to Enterprise" page (Lite's limits, account menu, About); null hides every upgrade link. */
  upgrade: string | null;
}

/** The EzyChat Enterprise section of the website. */
export const ENTERPRISE_UPGRADE_URL = 'https://ezychat.ai/#enterprise';

const liteReleaseNotes = (version: string): string =>
  `${GITHUB_REPO_URL}/releases/tag/v${encodeURIComponent(version)}`;

/** Lite's links: GitHub repository and issues, feedback on ezychat.ai. */
export const LITE_APP_LINKS: Readonly<AppLinks> = Object.freeze({
  website: EZYCHAT_WEBSITE_URL,
  reportIssue: GITHUB_ISSUES_URL,
  sourceCode: GITHUB_REPO_URL,
  releaseNotes: liteReleaseNotes,
  feedback: feedbackUrl,
  supportEmail: null,
  upgrade: ENTERPRISE_UPGRADE_URL,
});

/** Lite's links with the given overrides (an explicit `null` hides that link). */
export function resolveAppLinks(overrides: Partial<AppLinks> = {}): AppLinks {
  const links: AppLinks = { ...LITE_APP_LINKS };
  for (const key of Object.keys(overrides) as (keyof AppLinks)[]) {
    const value = overrides[key];
    if (value !== undefined) (links as unknown as Record<string, unknown>)[key] = value;
  }
  return links;
}

/** True when the release notes are Lite's own GitHub releases (opened via the desktop bridge). */
export function isLiteReleaseNotes(links: AppLinks): boolean {
  return links.releaseNotes === liteReleaseNotes;
}

/** Where "Report an issue" points: the page, else an email to support, else nothing. */
export function reportIssueHref(links: AppLinks): string | null {
  if (links.reportIssue) return links.reportIssue;
  if (links.supportEmail) return `mailto:${links.supportEmail}`;
  return null;
}

/** The link the share-the-app actions share: the source code page, else the website. */
export function shareAppUrl(links: AppLinks): string {
  return links.sourceCode ?? links.website;
}
