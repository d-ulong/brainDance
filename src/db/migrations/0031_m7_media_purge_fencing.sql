ALTER TABLE "media_objects" ADD COLUMN "purge_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_objects" DROP CONSTRAINT "media_objects_status_check";--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_status_check" CHECK ("status" IN ('staging', 'processing', 'ready', 'rejected', 'revoked', 'purging', 'purged'));--> statement-breakpoint
ALTER TABLE "media_purge_intents" ADD COLUMN "owned_generation" integer;--> statement-breakpoint
ALTER TABLE "media_purge_intents" DROP CONSTRAINT "media_purge_intents_status_check";--> statement-breakpoint
ALTER TABLE "media_purge_intents" ADD CONSTRAINT "media_purge_intents_status_check" CHECK ("status" IN ('pending', 'prepared', 'completed', 'dead'));--> statement-breakpoint
ALTER TABLE "media_purge_intents" ADD CONSTRAINT "media_purge_intents_owned_generation_check" CHECK (
  ("status" <> 'prepared') OR ("owned_generation" IS NOT NULL)
);
