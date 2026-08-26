ALTER TABLE "skills" ADD COLUMN "source_locator" text;
UPDATE "skills" SET "source_locator" = "source_identity" WHERE "source_locator" IS NULL;
ALTER TABLE "skills" ALTER COLUMN "source_locator" SET NOT NULL;
