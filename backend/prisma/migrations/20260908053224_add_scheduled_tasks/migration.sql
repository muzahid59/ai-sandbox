-- CreateEnum
CREATE TYPE "TaskExecutionStatus" AS ENUM ('success', 'failed', 'timeout', 'skipped');

-- DropIndex
DROP INDEX "idx_document_chunks_embedding";

-- DropIndex
DROP INDEX "idx_document_chunks_search_vector";

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "prompt" VARCHAR(2000) NOT NULL,
    "cron_expression" VARCHAR(100) NOT NULL,
    "timezone" VARCHAR(50) NOT NULL,
    "model" VARCHAR(50) NOT NULL,
    "thread_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "running" BOOLEAN NOT NULL DEFAULT false,
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_executions" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "message_id" TEXT,
    "status" "TaskExecutionStatus" NOT NULL,
    "error" VARCHAR(1000),
    "duration_ms" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "task_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_tasks_user_id_idx" ON "scheduled_tasks"("user_id");

-- CreateIndex
CREATE INDEX "scheduled_tasks_enabled_next_run_at_idx" ON "scheduled_tasks"("enabled", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_tasks_user_id_name_key" ON "scheduled_tasks"("user_id", "name");

-- CreateIndex
CREATE INDEX "task_executions_task_id_started_at_idx" ON "task_executions"("task_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
