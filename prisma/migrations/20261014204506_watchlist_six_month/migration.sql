-- AlterTable
ALTER TABLE "WatchlistSymbol" ADD COLUMN     "sixMonthAsOf" TIMESTAMP(3),
ADD COLUMN     "sixMonthChangePct" DOUBLE PRECISION;
