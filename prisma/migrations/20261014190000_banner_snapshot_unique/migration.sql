-- Keep the newest row of any duplicated (kind, capturedAt) capture, then make the pair unique.
DELETE FROM "BannerSnapshot" a
USING "BannerSnapshot" b
WHERE a."kind" = b."kind"
  AND a."capturedAt" = b."capturedAt"
  AND (a."createdAt" < b."createdAt" OR (a."createdAt" = b."createdAt" AND a."id" < b."id"));

-- CreateIndex
CREATE UNIQUE INDEX "BannerSnapshot_kind_capturedAt_key" ON "BannerSnapshot"("kind", "capturedAt");
