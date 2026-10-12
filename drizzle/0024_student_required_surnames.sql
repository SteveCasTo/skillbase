-- Existing surnames cannot be split reliably. The approved business-data reset
-- must run before this migration. Never infer or invent missing name components.
DO $$
BEGIN
  LOCK TABLE public.participants, public.interest_registrations IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.participants)
    OR EXISTS (SELECT 1 FROM public.interest_registrations) THEN
    RAISE EXCEPTION 'Student surnames require the reviewed business seed reset/correction before migration';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE public.participants
  ADD COLUMN paternal_surname text NOT NULL,
  ADD COLUMN maternal_surname text NOT NULL,
  DROP COLUMN last_name;
--> statement-breakpoint
ALTER TABLE public.interest_registrations
  ADD COLUMN paternal_surname text NOT NULL,
  ADD COLUMN maternal_surname text NOT NULL,
  DROP COLUMN last_name;
--> statement-breakpoint
ALTER TABLE public.participants
  ADD CONSTRAINT participants_paternal_surname_check CHECK (char_length(paternal_surname) BETWEEN 1 AND 150 AND paternal_surname = btrim(paternal_surname) AND paternal_surname !~ '[[:cntrl:]]'),
  ADD CONSTRAINT participants_maternal_surname_check CHECK (char_length(maternal_surname) BETWEEN 1 AND 150 AND maternal_surname = btrim(maternal_surname) AND maternal_surname !~ '[[:cntrl:]]');
--> statement-breakpoint
ALTER TABLE public.interest_registrations
  ADD CONSTRAINT interest_registrations_paternal_surname_check CHECK (char_length(paternal_surname) BETWEEN 1 AND 150 AND paternal_surname = btrim(paternal_surname) AND paternal_surname !~ '[[:cntrl:]]'),
  ADD CONSTRAINT interest_registrations_maternal_surname_check CHECK (char_length(maternal_surname) BETWEEN 1 AND 150 AND maternal_surname = btrim(maternal_surname) AND maternal_surname !~ '[[:cntrl:]]');
