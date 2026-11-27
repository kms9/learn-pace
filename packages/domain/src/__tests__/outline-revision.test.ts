import { expect, it } from "vitest";
import {
  assignOutlineIdentity, createKnowledgePoint, createLearningModule, createLearningProgress, createQuizAttempt,
  planOutlineRevision, reorderModules, stateDigest, withOutline,
} from "../index.js";

const module = (id: string, order: number) => createLearningModule({
  id, name: id, order, knowledge_points: [createKnowledgePoint({ id: id + "-kp", name: id, type: "procedure", module_id: id })],
});
const attempt = createQuizAttempt({ question_id: "q", knowledge_point_id: "A-kp", is_correct: true });
const initial = createLearningProgress({ book_id: "p", modules: [module("A", 0), module("B", 1)],
  mastery_levels: { "A-kp": 0.5 }, quiz_attempts: [attempt], current_module_id: "A" });

it("keeps only unique same-name and same-type identities across a replacement", () => {
  const replacement = module("New", 0);
  replacement.knowledge_points[0]!.name = " a ";
  const next = withOutline(initial, assignOutlineIdentity(initial, [replacement]));
  expect(next.modules[0]?.knowledge_points[0]).toMatchObject({ id: "A-kp", module_id: "New" });
  expect(next.mastery_levels).toEqual(initial.mastery_levels);
  expect(next.quiz_attempts).toEqual([attempt]);
  expect(next.current_module_id).toBe("New");

  replacement.knowledge_points[0]!.type = "concept";
  const mismatched = withOutline(initial, assignOutlineIdentity(initial, [replacement]));
  expect(mismatched.mastery_levels).toEqual({});
  expect(mismatched.quiz_attempts).toEqual([attempt]);
});

it("plans a rewrite with a fresh ID while holding historical attempts", () => {
  const plan = planOutlineRevision(initial, [{ module_id: "A",
    rewrite: [{ knowledge_point_id: "A-kp", name: "Changed" }] }], undefined, () => "new");
  expect(plan.progress.modules[0]?.knowledge_points[0]?.id).toBe("new");
  expect(plan.progress.mastery_levels).toEqual({});
  expect(plan.progress.quiz_attempts).toEqual([attempt]);
  expect(plan.effects.rewritten).toEqual([{ previous_id: "A-kp", new_id: "new" }]);
  expect(plan.changes.length).toBeGreaterThan(0);
});

it("preserves objective identity and current module during a reorder", () => {
  const plan = planOutlineRevision(initial, [], ["B", "A"], () => "unexpected");
  expect(plan.progress.modules.map((m) => [m.id, m.order, m.knowledge_points[0]!.id]))
    .toEqual([["B", 0, "B-kp"], ["A", 1, "A-kp"]]);
  expect(plan.progress.current_module_id).toBe("A");
  expect(plan.progress.mastery_levels).toEqual(initial.mastery_levels);
  for (const invalid of [["B"], ["B", "B"], ["B", "other"]]) {
    expect(() => reorderModules(initial.modules, invalid)).toThrow(/module_order/);
  }
});

it("compares content independently of version and update timestamp", () => {
  expect(stateDigest({ ...initial, version: 999, updated_at: 999 })).toEqual(stateDigest(initial));
  expect(stateDigest({ ...initial, mastery_levels: { "A-kp": 0.8 } })).not.toEqual(stateDigest(initial));
});
