-- The mod loader, renamed and split, for the move from RLCraft Dregora
-- (Forge 1.12.2) to Homestead (Fabric 1.20.1).
--
-- RENAME, not drop-and-add: server_info holds exactly one row and its
-- loader version is live data the public page and /info modpack both read.
-- Dropping the column would blank them until the next seed run.
--
-- loader_name is backfilled to 'Forge' rather than 'Fabric' on purpose. This
-- migration describes the shape of the table, not the contents of the pack;
-- the row still describes Dregora at the moment it runs, and it is the seed
-- that moves it to Fabric. A migration that quietly rewrote the data would
-- make the two steps impossible to run independently.
ALTER TABLE "server_info" RENAME COLUMN "forge_version" TO "loader_version";--> statement-breakpoint
ALTER TABLE "server_info" ADD COLUMN "loader_name" text DEFAULT 'Forge' NOT NULL;
