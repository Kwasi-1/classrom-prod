CREATE TYPE "public"."assignment_status" AS ENUM('draft', 'published', 'closed');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('queued', 'running', 'graded', 'error');--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"classroom_id" integer NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"template_repo" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"status" "assignment_status" DEFAULT 'draft' NOT NULL,
	"invite_code" text,
	"autograde_paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_invite_code_unique" UNIQUE("invite_code"),
	CONSTRAINT "assignments_classroom_slug" UNIQUE("classroom_id","slug")
);
--> statement-breakpoint
CREATE TABLE "classroom_staff" (
	"classroom_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "classroom_staff_classroom_id_user_id_pk" PRIMARY KEY("classroom_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "classrooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"installation_id" integer NOT NULL,
	"owner_user_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"term" text NOT NULL,
	"grader_repo" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classrooms_installation_slug" UNIQUE("installation_id","slug")
);
--> statement-breakpoint
CREATE TABLE "installations" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_installation_id" bigint NOT NULL,
	"org_login" text NOT NULL,
	"org_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installations_github_installation_id_unique" UNIQUE("github_installation_id")
);
--> statement-breakpoint
CREATE TABLE "roster" (
	"id" serial PRIMARY KEY NOT NULL,
	"classroom_id" integer NOT NULL,
	"github_login" text NOT NULL,
	"user_id" integer,
	CONSTRAINT "roster_classroom_login" UNIQUE("classroom_id","github_login")
);
--> statement-breakpoint
CREATE TABLE "student_repos" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"roster_id" integer NOT NULL,
	"repo_name" text NOT NULL,
	"repo_id" bigint NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	CONSTRAINT "student_repos_repo_id_unique" UNIQUE("repo_id"),
	CONSTRAINT "student_repos_assignment_roster" UNIQUE("assignment_id","roster_id")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_repo_id" integer NOT NULL,
	"sha" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "submission_status" DEFAULT 'queued' NOT NULL,
	"score" numeric,
	"max_score" numeric,
	"results" jsonb,
	"is_late" boolean DEFAULT false NOT NULL,
	CONSTRAINT "submissions_repo_sha" UNIQUE("student_repo_id","sha")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_id" bigint NOT NULL,
	"github_login" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_staff" ADD CONSTRAINT "classroom_staff_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_staff" ADD CONSTRAINT "classroom_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster" ADD CONSTRAINT "roster_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster" ADD CONSTRAINT "roster_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_repos" ADD CONSTRAINT "student_repos_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_repos" ADD CONSTRAINT "student_repos_roster_id_roster_id_fk" FOREIGN KEY ("roster_id") REFERENCES "public"."roster"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_repo_id_student_repos_id_fk" FOREIGN KEY ("student_repo_id") REFERENCES "public"."student_repos"("id") ON DELETE cascade ON UPDATE no action;