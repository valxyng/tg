-- Explicit, database-backed availability adjustments and recurring breaks.
CREATE TYPE "BlockedTimeKind" AS ENUM ('BLOCKED', 'BREAK');

ALTER TABLE "BlockedTime" ADD COLUMN "kind" "BlockedTimeKind" NOT NULL DEFAULT 'BLOCKED';

CREATE TABLE "WorkingBreak" (
    "id" TEXT NOT NULL,
    "masterId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    CONSTRAINT "WorkingBreak_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AvailabilityWindow" (
    "id" TEXT NOT NULL,
    "masterId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AvailabilityWindow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkingBreak_masterId_weekday_idx" ON "WorkingBreak"("masterId", "weekday");
CREATE INDEX "AvailabilityWindow_masterId_startsAt_endsAt_idx" ON "AvailabilityWindow"("masterId", "startsAt", "endsAt");
ALTER TABLE "WorkingBreak" ADD CONSTRAINT "WorkingBreak_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "Master"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityWindow" ADD CONSTRAINT "AvailabilityWindow_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "Master"("id") ON DELETE CASCADE ON UPDATE CASCADE;
