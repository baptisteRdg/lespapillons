-- CreateIndex
CREATE INDEX "activities_type_idx" ON "activities"("type");

-- CreateIndex
CREATE INDEX "activities_latitude_longitude_idx" ON "activities"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "friend_requests_toId_status_idx" ON "friend_requests"("toId", "status");
