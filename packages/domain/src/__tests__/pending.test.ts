import { describe, expect, it } from "vitest";
import { createPendingQuestion } from "../models.js";
import {
  isReadableChoiceAnswer,
  parseOptions,
  publicPendingQuestion,
  resolveAnswer,
  resolveChoiceSubmission,
  supersedesUngradedReply,
} from "../pending.js";

describe("pending question helpers (DeepTutor pending.py parity)", () => {
  it("parses labelled options and avoids mislabelling math formulas", () => {
    expect(parseOptions(["A: red", "B: blue", "C: green"])).toEqual({
      A: "red",
      B: "blue",
      C: "green",
    });

    // Math equations starting with a letter must be read positionally
    expect(parseOptions(["x - 1 = 0", "y - 2 = 0"])).toEqual({
      A: "x - 1 = 0",
      B: "y - 2 = 0",
    });
  });

  it("resolves choice submissions and distinguishes questions from answers", () => {
    const opts = { A: "x = 1", B: "x = 2", C: "x = 3" };
    expect(resolveChoiceSubmission("选C", opts)).toBe("C");
    expect(resolveChoiceSubmission("x=2", opts)).toBe("B");
    expect(resolveAnswer("x = 3", opts)).toBe("C");

    expect(isReadableChoiceAnswer("B", opts)).toBe(true);
    expect(isReadableChoiceAnswer("我选C", opts)).toBe(true);
    expect(isReadableChoiceAnswer("why is B wrong?", opts)).toBe(false);
    expect(isReadableChoiceAnswer("为什么选B？", opts)).toBe(false);
  });

  it("projects public pending question without exposing expected_answer", () => {
    const pending = createPendingQuestion({
      question_id: "q-1",
      knowledge_point_id: "kp-1",
      prompt: "Pick blue",
      question_type: "choice",
      expected_answer: "B",
      explanation: "Because sky",
      options: [
        { label: "A", body: "red" },
        { label: "B", body: "blue" },
      ],
    });
    const pub = publicPendingQuestion(pending);
    expect(pub).toEqual({
      question_id: "q-1",
      prompt: "Pick blue",
      question_type: "choice",
      options: [
        { id: "A", label: "A", body: "red" },
        { id: "B", label: "B", body: "blue" },
      ],
    });
    expect("expected_answer" in pub).toBe(false);
    expect("explanation" in pub).toBe(false);
  });

  it("only supersedes ungraded non-final replies when fresh text differs", () => {
    expect(supersedesUngradedReply("explain?", "B", { final: false })).toBe("B");
    expect(supersedesUngradedReply("explain?", "explain?", { final: false })).toBeNull();
    expect(supersedesUngradedReply("A", "B", { final: true })).toBeNull();
  });
});
