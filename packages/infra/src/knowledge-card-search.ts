import type { StoredKnowledgeCard } from "./index.js";

export function searchKnowledgeCards(cards: StoredKnowledgeCard[], query?: string): StoredKnowledgeCard[] {
  const text = query?.trim().toLocaleLowerCase();
  return text ? cards.filter(({ title, content, note }) =>
    [title, content, note].some((value) => value.toLocaleLowerCase().includes(text))) : cards;
}
