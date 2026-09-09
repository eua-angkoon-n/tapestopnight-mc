ALTER TABLE "server_info" ADD COLUMN "icon_source" "bytea";--> statement-breakpoint
ALTER TABLE "server_info" ADD COLUMN "icon_source_mime" text;--> statement-breakpoint
ALTER TABLE "server_info" ADD COLUMN "icon_source_sha256" text;--> statement-breakpoint
ALTER TABLE "server_info" ADD COLUMN "icon_64" "bytea";--> statement-breakpoint
ALTER TABLE "server_info" ADD COLUMN "icon_updated_by" text;--> statement-breakpoint
ALTER TABLE "server_info" ADD COLUMN "icon_updated_at" timestamp with time zone;