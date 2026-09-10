CREATE TYPE "public"."bridge_channel_kind" AS ENUM('chat', 'milestone');--> statement-breakpoint
CREATE TYPE "public"."chat_source" AS ENUM('game', 'web', 'discord');--> statement-breakpoint
CREATE TYPE "public"."link_via" AS ENUM('ip', 'code');--> statement-breakpoint
CREATE TABLE "bridge_channel" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"kind" "bridge_channel_kind" NOT NULL,
	"note" text,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" "chat_source" NOT NULL,
	"author_name" text NOT NULL,
	"author_discord_id" text,
	"body" text NOT NULL,
	"delivered_to_game" boolean DEFAULT false NOT NULL,
	"delivered_to_discord" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_code" (
	"code" text PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notable_milestone" (
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notable_milestone_kind_key_pk" PRIMARY KEY("kind","key")
);
--> statement-breakpoint
CREATE TABLE "player_ip_seen" (
	"mc_name" text NOT NULL,
	"ip" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_ip_seen_mc_name_ip_pk" PRIMARY KEY("mc_name","ip")
);
--> statement-breakpoint
CREATE TABLE "player_link" (
	"mc_name" text PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"linked_via" "link_via" NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_link_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
CREATE TABLE "player_milestone" (
	"mc_name" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"detail" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_milestone_mc_name_kind_key_pk" PRIMARY KEY("mc_name","kind","key")
);
--> statement-breakpoint
CREATE INDEX "chat_message_pending_idx" ON "chat_message" USING btree ("delivered_to_game","delivered_to_discord");--> statement-breakpoint
CREATE INDEX "player_ip_seen_ip_idx" ON "player_ip_seen" USING btree ("ip");