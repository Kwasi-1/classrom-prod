ALTER TABLE "classrooms" DROP CONSTRAINT "classrooms_installation_slug";--> statement-breakpoint
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_slug" UNIQUE("slug");