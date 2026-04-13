-- CreateEnum
CREATE TYPE "ToolCallStatus" AS ENUM ('pending', 'running', 'success', 'error');

-- CreateTable
CREATE TABLE "tool_calls" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "result" JSONB,
    "status" "ToolCallStatus" NOT NULL DEFAULT 'pending',
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tool_calls_message_id_idx" ON "tool_calls"("message_id");

-- AddForeignKey
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
