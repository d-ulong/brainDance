CREATE TABLE push_library_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
 body text NOT NULL CHECK (length(body) <= 10000), link_url text CHECK (length(link_url) <= 2048),
 tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0), create_key text NOT NULL, create_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT push_library_owner_create_unique UNIQUE(owner_id, create_key)
);
--> statement-breakpoint
CREATE TABLE push_library_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entry_id uuid NOT NULL REFERENCES push_library_entries(id),
 revision integer NOT NULL CHECK (revision > 0), command_key text NOT NULL, payload_hash text NOT NULL,
 tags jsonb NOT NULL CHECK (jsonb_typeof(tags) = 'array'), created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT push_library_publication_command_unique UNIQUE(entry_id, command_key)
);
--> statement-breakpoint
CREATE TABLE push_library_deliveries (
 publication_id uuid NOT NULL REFERENCES push_library_publications(id), student_id uuid NOT NULL REFERENCES users(id),
 push_id uuid PRIMARY KEY REFERENCES family_pushes(id),
 CONSTRAINT push_library_publication_student_unique UNIQUE(publication_id, student_id)
);
