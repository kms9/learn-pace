/**
 * Public, stable views of pending mastery questions and choice-answer parsing.
 * Exact TypeScript port of DeepTutor `deeptutor/learning/pending.py` (commit 1284116).
 */

import type { PendingQuestion } from "./models.js";

export const OPTION_PREFIX_RE = /^\s*([A-Z])\s*[.:：、)）-]\s*(.+)$/is;

export function positionalLabel(index: number): string {
  return index < 26 ? String.fromCharCode("A".charCodeAt(0) + index) : String(index + 1);
}

function optionTexts(options: readonly string[]): string[] {
  const result: string[] = [];
  for (const raw of options) {
    const text = String(raw ?? "").trim();
    if (text) {
      result.push(text);
    }
  }
  return result;
}

function splitLabelled(texts: readonly string[]): [string[], string[]] | null {
  const labels: string[] = [];
  const bodies: string[] = [];
  for (const text of texts) {
    if (text.length === 1 && /^[0-9A-Za-z]$/.test(text)) {
      labels.push(text.toUpperCase());
      bodies.push(text);
      continue;
    }
    const match = OPTION_PREFIX_RE.exec(text);
    if (!match) {
      return null;
    }
    labels.push(match[1]!.toUpperCase());
    bodies.push(match[2]!.trim());
  }
  return [labels, bodies];
}

export function optionLabelIntent(options: readonly string[]): string[] | null {
  const split = splitLabelled(optionTexts(options));
  if (!split) {
    return null;
  }
  const [labels] = split;
  return labels.length > 0 && labels[0] === "A" ? labels : null;
}

export function canonicalLabels(count: number): Set<string> {
  const labels = new Set<string>();
  for (let i = 0; i < count; i++) {
    labels.add(positionalLabel(i));
  }
  return labels;
}

export function parseOptions(options: readonly string[]): Record<string, string> {
  const texts = optionTexts(options);
  const split = splitLabelled(texts);
  if (split) {
    const [labels, bodies] = split;
    const expected = canonicalLabels(labels.length);
    const uniqueLabels = new Set(labels);
    if (
      labels[0] === "A" &&
      uniqueLabels.size === expected.size &&
      [...uniqueLabels].every((l) => expected.has(l))
    ) {
      const map: Record<string, string> = {};
      for (let i = 0; i < labels.length; i++) {
        map[labels[i]!] = bodies[i]!;
      }
      return map;
    }
  }
  const fallback: Record<string, string> = {};
  for (let i = 0; i < texts.length; i++) {
    fallback[positionalLabel(i)] = texts[i]!;
  }
  return fallback;
}

export function hasOptionBodies(options: Record<string, string>): boolean {
  const entries = Object.entries(options);
  return (
    entries.length >= 2 &&
    entries.every(
      ([key, value]) => value.trim().length > 0 && value.trim().toUpperCase() !== key.toUpperCase(),
    )
  );
}

export function resolveAnswer(answer: string, options: Record<string, string>): string {
  const candidate = String(answer ?? "").trim();
  if (!candidate) {
    return "";
  }
  const key = candidate.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(options, key)) {
    return key;
  }
  const prefixMatch = OPTION_PREFIX_RE.exec(candidate);
  if (prefixMatch) {
    const prefixKey = prefixMatch[1]!.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(options, prefixKey)) {
      return prefixKey;
    }
  }
  const needle = candidate.toLowerCase();
  const exact = Object.entries(options)
    .filter(([, text]) => text.toLowerCase() === needle)
    .map(([label]) => label);
  if (exact.length === 1) {
    return exact[0]!;
  }
  const contained = Object.entries(options)
    .filter(([, text]) => text.toLowerCase().includes(needle))
    .map(([label]) => label);
  return contained.length === 1 ? contained[0]! : "";
}

function squeezed(value: string): string {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionedLabels(text: string, labels: readonly string[]): string[] {
  return labels.filter((label) => {
    const re = new RegExp(`(?<![0-9A-Za-z])${escapeRegExp(label)}(?![0-9A-Za-z])`, "i");
    return re.test(text);
  });
}

export function resolveChoiceSubmission(answer: string, options: Record<string, string>): string {
  const candidate = String(answer ?? "").trim();
  if (!candidate) {
    return "";
  }
  const key = candidate.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(options, key)) {
    return key;
  }
  const prefixMatch = OPTION_PREFIX_RE.exec(candidate);
  if (prefixMatch) {
    const prefixKey = prefixMatch[1]!.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(options, prefixKey)) {
      return prefixKey;
    }
  }
  const needle = squeezed(candidate);
  const exact = Object.entries(options)
    .filter(([, body]) => squeezed(body) === needle)
    .map(([label]) => label);
  if (exact.length === 1) {
    return exact[0]!;
  }
  const mentioned = mentionedLabels(candidate, Object.keys(options));
  return mentioned.length === 1 ? mentioned[0]! : "";
}

export function isReadableChoiceAnswer(
  answer: string,
  options: readonly string[] | Record<string, string>,
): boolean {
  const optionMap: Record<string, string> = Array.isArray(options)
    ? parseOptions(options)
    : (options as Record<string, string>);
  if (Object.keys(optionMap).length === 0) {
    return false;
  }
  const candidate = String(answer ?? "").trim();
  const resolved = resolveChoiceSubmission(candidate, optionMap);
  if (!resolved) {
    return false;
  }

  const labelRe = escapeRegExp(resolved);
  if (new RegExp(`^${labelRe}[。.!！]?$`, "i").test(candidate)) {
    return true;
  }
  const prefixMatch = OPTION_PREFIX_RE.exec(candidate);
  if (prefixMatch && prefixMatch[1]!.toUpperCase() === resolved) {
    return true;
  }
  if (squeezed(candidate) === squeezed(optionMap[resolved] ?? "")) {
    return true;
  }

  if (
    /[?？]|\b(?:why|what|how|can|could|would|explain)\b|(?:为什么|为何|怎么|如何|什么|解释一下|请解释)/i.test(
      candidate,
    )
  ) {
    return false;
  }

  return new RegExp(
    `(?:\\b(?:answer(?:\\s+is)?|choose|pick|select|think(?:\\s+it(?:'s|\\s+is))?|go\\s+with)\\s*(?:option\\s*)?${labelRe}\\b|(?:答案(?:是|为)?|我?选(?:择)?|应该是|我觉得是)\\s*${labelRe})`,
    "i",
  ).test(candidate);
}

export function supersedesUngradedReply(
  stored: unknown,
  incoming: unknown,
  result: Record<string, unknown> | null,
): string | null {
  if (!result || result["final"] !== false) {
    return null;
  }
  const previous = String(stored ?? "").trim();
  const fresh = String(incoming ?? "").trim();
  if (!fresh || fresh === previous) {
    return null;
  }
  return fresh;
}

export interface PublicPendingOption {
  id: string;
  label: string;
  body: string;
}

export interface PublicPendingQuestion {
  question_id: string;
  prompt: string;
  question_type: string;
  options: PublicPendingOption[];
  questions?: PublicPendingQuestion[];
}

export function publicPendingQuestion(pending: PendingQuestion): PublicPendingQuestion {
  const options: PublicPendingOption[] =
    pending.question_type === "choice"
      ? pending.options.map((opt) => ({
          id: opt.label,
          label: opt.label,
          body: opt.body,
        }))
      : [];

  const result: PublicPendingQuestion = {
    question_id: pending.question_id,
    prompt: pending.prompt,
    question_type: pending.question_type,
    options,
  };

  if (pending.questions && pending.questions.length > 0) {
    result.questions = pending.questions.map((child) => publicPendingQuestion(child));
  }

  return result;
}
