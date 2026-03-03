-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "pseudo" TEXT NOT NULL,
    "avatar" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "activityId" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ratings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ratings_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "todo_activities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "activityId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "todo_activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "todo_activities_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "done_activities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "activityId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "done_activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "done_activities_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "friendships" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "friendId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "friendships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "friendships_friendId_fkey" FOREIGN KEY ("friendId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "friend_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "friend_requests_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "friend_requests_toId_fkey" FOREIGN KEY ("toId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "groups_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "group_activities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "activityId" INTEGER NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_activities_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "group_activities_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_favorites" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "activityId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "favorites_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_favorites" ("activityId", "createdAt", "id", "userId") SELECT "activityId", "createdAt", "id", "userId" FROM "favorites";
DROP TABLE "favorites";
ALTER TABLE "new_favorites" RENAME TO "favorites";
CREATE UNIQUE INDEX "favorites_userId_activityId_key" ON "favorites"("userId", "activityId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_pseudo_key" ON "users"("pseudo");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_userId_activityId_key" ON "ratings"("userId", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX "todo_activities_userId_activityId_key" ON "todo_activities"("userId", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX "done_activities_userId_activityId_key" ON "done_activities"("userId", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX "friendships_userId_friendId_key" ON "friendships"("userId", "friendId");

-- CreateIndex
CREATE UNIQUE INDEX "friend_requests_fromId_toId_key" ON "friend_requests"("fromId", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_groupId_userId_key" ON "group_members"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "group_activities_groupId_activityId_key" ON "group_activities"("groupId", "activityId");
