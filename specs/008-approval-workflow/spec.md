# Feature Specification: Human-in-the-Loop Approval Workflow

**Feature ID**: 008
**Short Name**: approval-workflow
**Status**: Draft
**Created**: 2026-09-07
**Author**: Muzahidul Islam

---

## Overview

Before the AI executes high-stakes or irreversible actions (sending an email, creating or deleting a calendar event), it pauses and presents an approval card inline in the chat thread. The user can inspect exactly what the AI intends to do, then choose to approve or reject. Only approved actions proceed to execution; rejected actions are cancelled and the AI informs the user of the outcome.

---

## Problem Statement

The current agentic loop executes tools immediately and silently. For read-only tools (web search, fetch URL, document search) this is acceptable — the worst outcome is a wasted API call. But for write or destructive tools, a misunderstood instruction or model error can cause harm that is difficult to reverse: an email sent to the wrong person, a calendar event deleted, a message posted in the wrong channel. Users currently have no opportunity to review or stop these actions before they happen.

---

## Goals

1. Allow specific tools to declare themselves as requiring explicit user approval before execution.
2. When a flagged tool is called, pause the agentic loop and present an approval card in the chat thread showing the action name and the exact arguments the AI intends to use.
3. Provide Approve and Reject buttons; only proceed with execution after the user approves.
4. Resume the agentic loop seamlessly after approval, feeding the tool result back to the AI as normal.
5. On rejection, cancel the action and inform the AI so it can acknowledge the outcome to the user.
6. Pending approvals survive browser refreshes — the approval card re-appears when the user returns to the thread.
7. Pending actions that are never acted on auto-reject after 10 minutes.

---

## Non-Goals

- Approval for every tool call — only tools explicitly flagged as requiring approval.
- Multi-approver or team-review workflows (one user, one approval in this phase).
- A separate approval management page or notification inbox.
- Configuring which tools require approval via the UI (hardcoded per tool definition in this phase).
- Audit logs or approval history (deferred to Phase 5 observability).
- Approval for tool calls triggered by scheduled or recurring tasks (Phase 3.2 dependency).

---

## User Scenarios & Testing

### Scenario 1: AI wants to send an email — user approves

**Given** the user says "Send an email to Sarah confirming our 3pm meeting"  
**When** the AI determines it should call `send_email` with recipient, subject, and body  
**Then** the agentic loop pauses and an approval card appears in the chat showing the action name, recipient, subject, and a body preview

**Given** the approval card is visible  
**When** the user clicks "Approve"  
**Then** the email is sent, the card updates to show "Approved", and the AI streams a confirmation response

---

### Scenario 2: AI wants to delete a calendar event — user rejects

**Given** the user says "Cancel my 3pm meeting"  
**When** the AI calls `delete_calendar_event` with the event details  
**Then** an approval card appears showing the event title, date, and time

**Given** the approval card is visible  
**When** the user clicks "Reject"  
**Then** the event is not deleted, the card updates to show "Rejected", and the AI tells the user the action was cancelled

---

### Scenario 3: User refreshes the page with a pending approval

**Given** an approval card is waiting for user action  
**When** the user refreshes the browser or returns to the thread  
**Then** the approval card re-appears in the same pending state, and the agentic loop is still paused

**Variant 3a: User remains on page during timeout**

**Given** an approval card has been pending for more than 10 minutes with the user on the page  
**When** the 10-minute timeout passes  
**Then** the card status updates to "Expired" via periodic polling (without requiring a refresh), and an assistant message appears in the thread noting the action was cancelled

---

### Scenario 4: Approval timeout

**Given** an approval card has been pending for 10 minutes with no user action  
**When** the timeout elapses  
**Then** the action auto-rejects, the card updates to show "Expired" (detected via periodic status polling), and the agentic loop resumes with the rejection result

---

### Scenario 5: Non-flagged tool — no approval needed

**Given** the user asks "Search the web for recent AI news"  
**When** the AI calls `web_search`  
**Then** the search executes immediately with no approval card (unchanged behaviour)

---

### Scenario 6: User attempts to act on an already-resolved approval

**Given** a pending action has already been approved or rejected  
**When** the user attempts to approve or reject it again  
**Then** the action is rejected with an appropriate error and the card displays its terminal status

---

## Functional Requirements

### FR1 — Tool approval flag
Tools can declare themselves as requiring approval as part of their definition. This is a static declaration, not a runtime setting.

### FR2 — Loop suspension
When the agentic loop encounters an approval-required tool call, it suspends execution before running the tool and persists the pending action to durable storage. Only one pending approval can exist per thread at a time — the chat input is disabled while a pending action is waiting, preventing new messages and a second loop from starting.

### FR3 — Pending action record
A pending action record stores: the tool name, the exact arguments the AI provided, the associated thread and message context, timestamps, and current status (`pending` / `approved` / `rejected` / `expired`).

### FR4 — SSE event on suspension
When the loop suspends, a real-time event is emitted to the client containing the pending action ID, tool name, and arguments so the approval card renders immediately without a page reload.

### FR5 — Approval card UI
The approval card renders inline in the chat thread (not a modal or separate page). It displays:
- A human-readable action name derived mechanically from the tool definition ID (e.g. `send_email` → "Send email": capitalize and replace underscores with spaces)
- All arguments in a readable formatted preview (not raw JSON), displayed as labeled key-value pairs (e.g., "Recipient: sarah@example.com") with tool-specific formatting for rich fields (e.g., email body shown as prose, not a stringified JSON value)
- Approve and Reject buttons (disabled once the action is resolved)
- Current status: Pending / Approved / Rejected / Expired

While any approval card is in Pending status, the chat input for that thread is disabled with a message indicating the user must act on the pending approval above before continuing.

### FR6 — Approve endpoint
Validates ownership, transitions status to `approved`, triggers tool execution, resumes the agentic loop, and delivers the AI's follow-up response via SSE. If the tool execution fails (e.g. external API error), the agentic loop receives the error as the tool result and the AI reports the failure in a follow-up message; the card remains in "Approved" status since the user's decision was honoured. No additional `failed` status is required on PendingAction.

### FR7 — Reject endpoint
Validates ownership, transitions status to `rejected`, resumes the agentic loop with a rejection signal so the AI can acknowledge the cancellation to the user. Rejection is binary — no reason field is required or collected. The Reject button is a single click with no additional input.

### FR8 — Idempotency
A pending action that has already been approved, rejected, or expired cannot be transitioned again. Duplicate attempts return an error.

### FR9 — Expiry
Pending actions older than 10 minutes auto-reject. A background process detects and transitions expired actions, and an assistant message is created in the thread to notify the user of the expiry. The approval card updates to "Expired" status when the expiry is detected (within 60 seconds of the timeout).

### FR10 — Persistence across restart and reload
When the user returns to a thread containing a pending action — whether after a browser refresh or a server restart — the approval card is restored from the server-side record. On approval post-restart, the approve endpoint reconstructs the agentic loop from stored context (thread message history, toolCallId, arguments) rather than requiring a live in-memory loop.

### FR11 — Thread and user scoping
A user can only approve or reject pending actions belonging to their own threads. Cross-user or cross-thread access returns a not-found response.

---

## Success Criteria

1. **Zero unintended executions**: No approval-required tool executes without explicit user approval.
2. **Approval card renders within 2 seconds** — measured from SSE event arrival on the client to card visible on screen (including network latency).
3. **Approve and Reject complete within 3 seconds** — the AI's follow-up response begins streaming within 3 seconds of the user clicking either button.
4. **Full persistence on reload**: 100% of pending approval cards re-appear correctly after a browser refresh.
5. **Reliable auto-expiry**: Pending actions older than 10 minutes are auto-rejected within 60 seconds of the timeout expiring. If user remains on page, card status updates via polling; if user is away, expiry notification appears on next page visit.
6. **No regression on existing tools**: web search, document search, and fetch URL continue to execute without any approval step.

---

## Key Entities

### PendingAction

| Field        | Description                                                  |
|--------------|--------------------------------------------------------------|
| id           | Unique identifier (UUID)                                     |
| threadId     | Thread this action belongs to                                |
| userId       | Owning user (for authorization — see FR11)                   |
| messageId    | The assistant message that triggered the action              |
| toolName     | The tool the AI wants to call (e.g. `send_email`)            |
| toolCallId   | The tool call ID from the AI provider                        |
| arguments    | The exact arguments the AI supplied (structured data)        |
| status       | `pending` / `approved` / `rejected` / `expired`             |
| resolvedAt   | When the action was approved, rejected, or expired (nullable)|
| expiresAt    | When the action auto-expires if not acted on                 |
| createdAt    | Creation timestamp                                           |

---

## Dependencies

- Real authentication (005) is recommended — pending actions are user-scoped. The current hardcoded dev middleware (`auth.ts`) provides a `req.user` sufficient for development and testing. Production deployment requires real auth.
- The agentic loop (`toolExecutor.ts`) must be extended to support pause and resume.
- At least one approval-required tool must exist. A stub "test approval tool" with no real side effects will be used during development; `send_email` (Phase 4.2) is the first production consumer.

---

## Clarifications

### Session 2026-09-07

- Q: If the user approves and the tool execution fails, what does the user experience? → A: The agentic loop receives the error as the tool result and the AI reports the failure in a follow-up message. The approval card stays "Approved" — no new `failed` status on PendingAction.
- Q: When the server restarts with pending actions in the database, what happens on approval? → A: The approve endpoint reconstructs and resumes the agentic loop from stored context (thread message history + toolCallId + arguments from PendingAction). No additional fields needed on PendingAction beyond what is already specified.
- Q: Can a thread have more than one pending approval at the same time? → A: No — only one pending approval per thread at a time. While one is waiting, the chat input is disabled with a message indicating approval is required above.
- Q: When the user rejects an action, do they provide a reason? → A: Binary reject — one click, no reason field or text input. The AI acknowledges the cancellation and invites the user to clarify.

---

## Assumptions

- The 10-minute timeout is appropriate for interactive sessions; this can be made configurable in a future phase.
- Only one pending action can be active per agentic loop run — the loop suspends on the first flagged tool it encounters.
- The approval card is delivered via the existing SSE infrastructure; no separate WebSocket connection is needed.
- Arguments are displayed in human-readable format (e.g. email body as prose, not JSON string), with display formatting determined per tool.
- Rejected actions do not automatically retry — the user must re-ask the AI if they want it to try a different approach.
- Background expiry scan runs every 60 seconds; client-side status polling checks every 30 seconds when a pending action is present.
