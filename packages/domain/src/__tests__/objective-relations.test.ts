import { describe, expect, it } from "vitest";
import { createKnowledgePoint, createLearningModule, validateObjectiveRelations, type TopicSource } from "../index.js";

const points = (refs: Record<string, string[]>) => createLearningModule({ id: "m", name: "模块", order: 0,
  knowledge_points: Object.entries(refs).map(([id, prerequisite_ids]) =>
    createKnowledgePoint({ id, name: id, type: "concept", module_id: "m", prerequisite_ids })) });
const source = (id: string, kind: TopicSource["kind"]): TopicSource =>
  ({ id, kind, label: id, excerpt: "", created_at: 0 });

describe("objective relations", () => {
  it("accepts a shared prerequisite without treating it as a cycle", () => {
    expect(() => validateObjectiveRelations([points({ a: [], b: ["a"], c: ["a", "b"] })], [])).not.toThrow();
  });
  it("rejects duplicate ids, unknown and self prerequisites", () => {
    expect(() => validateObjectiveRelations([points({ a: [] }), points({ a: [] })], [])).toThrow(/知识点 ID/);
    expect(() => validateObjectiveRelations([points({ a: ["x"] })], [])).toThrow(/未知先修/);
    expect(() => validateObjectiveRelations([points({ a: ["a"] })], [])).toThrow(/不能依赖自身/);
  });
  it("identifies a full cycle", () => {
    expect(() => validateObjectiveRelations([points({ a: ["b"], b: ["c"], c: ["a"] })], []))
      .toThrow("a → b → c → a");
  });
  it("rejects goal and unknown source ids and allows a real source", () => {
    const module = points({ a: [] });
    const sources = [source("text", "text_note"), source("goal", "goal")];
    for (const id of ["goal", "missing"]) {
      module.knowledge_points[0]!.topic_source_ids = [id];
      expect(() => validateObjectiveRelations([module], sources)).toThrow(/未知或目标资料/);
    }
    module.knowledge_points[0]!.topic_source_ids = ["text"];
    expect(() => validateObjectiveRelations([module], sources)).not.toThrow();
  });
});
