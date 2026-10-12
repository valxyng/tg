-- Nullable per-master override; NULL keeps the existing global service price.
ALTER TABLE "MasterService" ADD COLUMN "priceKopecks" INTEGER;
