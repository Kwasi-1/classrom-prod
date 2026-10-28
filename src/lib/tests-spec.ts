import { parseDocument } from "yaml";
import { z } from "zod";

// Mirrors validate() in grader-template/grader/run_tests.py. The validated output is committed
// as tests.json next to tests.yml, so the runner never needs a YAML parser.

const nonEmpty = z.string().trim().min(1, "must not be empty");
// Teachers often write `expected: 5`; YAML parses that as a number, so accept and stringify.
const scalarText = z.union([z.string(), z.number(), z.boolean()], { error: "is required (text)" }).transform(String);
const points = z.number().nonnegative("must be >= 0");
const timeout = z.number().positive().max(60, "must be at most 60 seconds").default(10);

const IoTest = z
  .object({
    name: nonEmpty,
    type: z.literal("io"),
    run: nonEmpty,
    input: scalarText.optional(),
    expected: scalarText,
    match: z.enum(["exact", "contains", "regex"]).default("exact"),
    points,
    timeout,
    image: nonEmpty.optional(),
  })
  .strict();

const CommandTest = z
  .object({
    name: nonEmpty,
    type: z.literal("command"),
    run: nonEmpty,
    points,
    timeout,
    image: nonEmpty.optional(),
  })
  .strict();

export const TestsSpec = z
  .object({
    image: nonEmpty.default("python:3.12-slim"),
    setup: nonEmpty.optional(),
    tests: z.array(z.discriminatedUnion("type", [IoTest, CommandTest])).min(1, "at least one test is required"),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    spec.tests.forEach((test, i) => {
      if (seen.has(test.name)) ctx.addIssue({ code: "custom", path: ["tests", i, "name"], message: `duplicate test name "${test.name}"` });
      seen.add(test.name);
      if (test.type === "io" && test.match === "regex") {
        try {
          new RegExp(test.expected);
        } catch {
          ctx.addIssue({ code: "custom", path: ["tests", i, "expected"], message: "invalid regular expression" });
        }
      }
    });
  });

export type TestsSpec = z.infer<typeof TestsSpec>;

export type SpecResult = { ok: true; spec: TestsSpec } | { ok: false; errors: string[] };

function fmtPath(path: PropertyKey[]) {
  return path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("").replace(/^\./, "") || "(root)";
}

export function parseTestsYaml(text: string): SpecResult {
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length) return { ok: false, errors: doc.errors.map((e) => e.message) };
  const parsed = TestsSpec.safeParse(doc.toJS());
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${fmtPath(i.path)}: ${i.message}`) };
  }
  return { ok: true, spec: parsed.data };
}

export function maxScore(spec: TestsSpec) {
  return spec.tests.reduce((sum, t) => sum + t.points, 0);
}
