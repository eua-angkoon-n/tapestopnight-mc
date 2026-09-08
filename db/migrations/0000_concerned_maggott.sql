CREATE TYPE "public"."edit_tier" AS ENUM('FREE', 'GUARDED', 'LOCKED');--> statement-breakpoint
CREATE TABLE "admin_allowlist" (
	"discord_id" text PRIMARY KEY NOT NULL,
	"note" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allowed_channel" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"note" text,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_key" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"tier" "edit_tier" DEFAULT 'LOCKED' NOT NULL,
	"reason" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_info" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"modpack_name" text NOT NULL,
	"modpack_version" text NOT NULL,
	"minecraft_version" text NOT NULL,
	"forge_version" text NOT NULL,
	"server_address" text NOT NULL,
	"download_url" text,
	"icon_source_path" text,
	"rules_markdown" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_status_cache" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"online" boolean NOT NULL,
	"players_online" integer,
	"players_max" integer,
	"sample" jsonb,
	"motd" text,
	"last_seen_online" timestamp with time zone,
	"container_state" text,
	"probed_at" timestamp with time zone DEFAULT now() NOT NULL
);
