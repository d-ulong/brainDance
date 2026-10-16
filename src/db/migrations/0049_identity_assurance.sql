ALTER TABLE users ADD COLUMN admin_totp_last_step integer;
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;
--> statement-breakpoint
CREATE INDEX login_security_events_ip_time_idx ON login_security_events (ip_address, occurred_at);
--> statement-breakpoint
ALTER TABLE contact_verification_codes ADD COLUMN delivery_status text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE contact_verification_codes ADD COLUMN attempt_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE contact_verification_codes ADD CONSTRAINT contact_verification_delivery_status_check CHECK (delivery_status IN ('pending', 'sent', 'development', 'failed'));
--> statement-breakpoint
ALTER TABLE contact_verification_codes ADD CONSTRAINT contact_verification_attempt_count_check CHECK (attempt_count >= 0 AND attempt_count <= 5);
