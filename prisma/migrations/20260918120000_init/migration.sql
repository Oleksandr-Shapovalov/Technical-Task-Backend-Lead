-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('allow', 'flag', 'block');

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_moderation_results" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "decision" "Decision" NOT NULL,
    "reason" TEXT NOT NULL,
    "suggestedReply" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_moderation_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "comments_idempotencyKey_key" ON "comments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "comment_moderation_results_commentId_idx" ON "comment_moderation_results"("commentId");

-- AddForeignKey
ALTER TABLE "comment_moderation_results" ADD CONSTRAINT "comment_moderation_results_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
