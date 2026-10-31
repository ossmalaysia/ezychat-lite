import {
  SAFETY_HIGH_SCORE,
  SAFETY_RULES,
  SAFETY_WARNING_SCORE,
  type SafetyAiAnswer,
  type SafetyLevel,
  type SafetyRule,
} from '@ezychat/shared';

export interface SafetyDecision {
  score: number;
  ruleLevel: SafetyLevel;
  /** A rule marked critical fired: High whatever the AI says. */
  critical: boolean;
  level: SafetyLevel;
}

const RANK: Record<SafetyLevel, number> = { none: 0, warning: 1, high: 2 };

/**
 * Rules first; the AI may raise a level or confirm it, and may lower only a rules-only Warning to
 * none (a customer asking about their own payment). It never lowers a critical or High rule result,
 * so a message's own text cannot talk its way past the rules.
 */
export function decide(rules: readonly SafetyRule[], ai: SafetyAiAnswer | null): SafetyDecision {
  const critical = rules.some((r) => SAFETY_RULES[r].critical);
  const score = Math.min(
    100,
    rules.reduce((sum, r) => sum + SAFETY_RULES[r].points, 0),
  );
  const ruleLevel: SafetyLevel =
    critical || score >= SAFETY_HIGH_SCORE
      ? 'high'
      : score >= SAFETY_WARNING_SCORE
        ? 'warning'
        : 'none';
  if (!ai || critical) return { score, ruleLevel, critical, level: ruleLevel };
  if (ruleLevel === 'warning' && ai.level === 'none')
    return { score, ruleLevel, critical, level: 'none' };
  return {
    score,
    ruleLevel,
    critical,
    level: RANK[ai.level] > RANK[ruleLevel] ? ai.level : ruleLevel,
  };
}

/**
 * Auto-block (admin switch, off by default): only a critical rule, only a number that is not an
 * existing customer (a known customer sending one is most likely hacked: warn, never block), and
 * never from a group.
 */
export function shouldAutoBlock(p: {
  enabled: boolean;
  decision: SafetyDecision;
  existingCustomer: boolean;
  group: boolean;
  live: boolean;
}): boolean {
  return p.enabled && p.live && !p.group && p.decision.critical && !p.existingCustomer;
}
