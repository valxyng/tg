-- A non-destructive marker for the new, opt-in client profile flow.
ALTER TABLE "User" ADD COLUMN "profileCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "isBlocked" BOOLEAN NOT NULL DEFAULT false;

-- Clients with existing CRM data keep using the bot without being asked to register again.
UPDATE "User"
SET "profileCompleted" = true
WHERE "phone" IS NOT NULL
   OR EXISTS (SELECT 1 FROM "Pet" WHERE "Pet"."ownerId" = "User"."id")
   OR EXISTS (SELECT 1 FROM "Booking" WHERE "Booking"."clientId" = "User"."id");
