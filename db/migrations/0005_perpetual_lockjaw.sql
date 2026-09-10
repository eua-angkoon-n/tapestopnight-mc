-- One channel can carry both kinds.
--
-- The first draft keyed bridge_channel on the channel alone, which cannot
-- express "this channel is the conversation AND the congratulations" — a normal
-- way to run a small server, and the shape this one asked for on day one.
--
-- The constraint name is filled in by hand: drizzle-kit cannot read the
-- existing primary key's name, and left to itself it emits a commented-out DROP
-- that would leave the old single-column key in place and the migration silently
-- half-applied. Verified against the Host as `bridge_channel_pkey`.
ALTER TABLE "bridge_channel" DROP CONSTRAINT "bridge_channel_pkey";--> statement-breakpoint
ALTER TABLE "bridge_channel" ADD CONSTRAINT "bridge_channel_channel_id_kind_pk" PRIMARY KEY("channel_id","kind");
