-- AlterTable
-- SQLite doesn't support ALTER COLUMN, so we need to recreate the table
-- First, create a new table with the correct schema
CREATE TABLE "products_new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 0,
    "unit" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Copy data from old table to new table
INSERT INTO "products_new" ("id", "name", "quantity", "unit", "createdAt", "updatedAt")
SELECT "id", "name", "quantity", 
       CASE WHEN "unit" = 'יחידות' THEN NULL ELSE "unit" END,
       "createdAt", "updatedAt"
FROM "products";

-- Drop old table
DROP TABLE "products";

-- Rename new table
ALTER TABLE "products_new" RENAME TO "products";
