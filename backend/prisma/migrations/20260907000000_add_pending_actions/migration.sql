-- CreateEnum
CREATE TYPE "PendingActionStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- CreateTable
CREATE TABLE "pending_actions" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "tool_name" VARCHAR(100) NOT NULL,
    "tool_call_id" VARCHAR(100) NOT NULL,
    "arguments" JSONB NOT NULL,
    "status" "PendingActionStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_actions_message_id_key" ON "pending_actions"("message_id");

-- CreateIndex
CREATE INDEX "pending_actions_thread_id_status_idx" ON "pending_actions"("thread_id", "status");

-- CreateIndex
CREATE INDEX "pending_actions_user_id_idx" ON "pending_actions"("user_id");

-- CreateIndex
CREATE INDEX "pending_actions_expires_at_status_idx" ON "pending_actions"("expires_at", "status");

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
