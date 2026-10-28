import {
  bigint,
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const installations = pgTable("installations", {
  id: serial("id").primaryKey(),
  githubInstallationId: bigint("github_installation_id", { mode: "number" }).notNull().unique(),
  orgLogin: text("org_login").notNull(),
  orgId: bigint("org_id", { mode: "number" }).notNull(),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  githubLogin: text("github_login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
});

export const classrooms = pgTable(
  "classrooms",
  {
    id: serial("id").primaryKey(),
    installationId: integer("installation_id")
      .notNull()
      .references(() => installations.id),
    ownerUserId: integer("owner_user_id")
      .notNull()
      .references(() => users.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    term: text("term").notNull(),
    graderRepo: text("grader_repo").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("classrooms_installation_slug").on(t.installationId, t.slug)],
);

export const classroomStaff = pgTable(
  "classroom_staff",
  {
    classroomId: integer("classroom_id")
      .notNull()
      .references(() => classrooms.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.classroomId, t.userId] })],
);

export const roster = pgTable(
  "roster",
  {
    id: serial("id").primaryKey(),
    classroomId: integer("classroom_id")
      .notNull()
      .references(() => classrooms.id, { onDelete: "cascade" }),
    githubLogin: text("github_login").notNull(), // always lowercased
    userId: integer("user_id").references(() => users.id),
  },
  (t) => [unique("roster_classroom_login").on(t.classroomId, t.githubLogin)],
);

export const assignmentStatus = pgEnum("assignment_status", ["draft", "published", "closed"]);

export const assignments = pgTable(
  "assignments",
  {
    id: serial("id").primaryKey(),
    classroomId: integer("classroom_id")
      .notNull()
      .references(() => classrooms.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    templateRepo: text("template_repo").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    status: assignmentStatus("status").notNull().default("draft"),
    inviteCode: text("invite_code").unique(),
    autogradePaused: boolean("autograde_paused").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [unique("assignments_classroom_slug").on(t.classroomId, t.slug)],
);

export const studentRepos = pgTable(
  "student_repos",
  {
    id: serial("id").primaryKey(),
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    rosterId: integer("roster_id")
      .notNull()
      .references(() => roster.id),
    repoName: text("repo_name").notNull(),
    repoId: bigint("repo_id", { mode: "number" }).notNull().unique(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
  },
  (t) => [unique("student_repos_assignment_roster").on(t.assignmentId, t.rosterId)],
);

export const submissionStatus = pgEnum("submission_status", ["queued", "running", "graded", "error"]);

export type TestResult = {
  name: string;
  passed: boolean;
  points: number;
  max_points: number;
  duration_ms: number;
  output_excerpt: string;
};

export type SubmissionResults = {
  tests?: TestResult[];
  error?: string | null;
  source?: "webhook" | "reconcile";
};

export const submissions = pgTable(
  "submissions",
  {
    id: serial("id").primaryKey(),
    studentRepoId: integer("student_repo_id")
      .notNull()
      .references(() => studentRepos.id, { onDelete: "cascade" }),
    sha: text("sha").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    status: submissionStatus("status").notNull().default("queued"),
    score: numeric("score", { mode: "number" }),
    maxScore: numeric("max_score", { mode: "number" }),
    results: jsonb("results").$type<SubmissionResults>(),
    isLate: boolean("is_late").notNull().default(false),
  },
  (t) => [unique("submissions_repo_sha").on(t.studentRepoId, t.sha)],
);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  event: text("event").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
