# ⛔ MANDATORY — READ THIS BEFORE DOING ANYTHING ⛔

## STEP 1 (FIRST THING — NO EXCEPTIONS): RECALL MEMORY

Before writing ANY code, answering ANY question, or performing ANY task,
you MUST call `mcp_mcp-supermemo_recall` FIRST.

```
Tool: mcp_mcp-supermemo_recall
Args:
  containerTag: "sm_project_backend"
  query: <summarize what the user is asking about>
```

- This is NOT optional. This is NOT "nice to have". This is REQUIRED.
- Do NOT skip this even if the question seems simple.
- Do NOT skip this even if you think you already know the answer.
- If you skip this step, the entire response is considered INVALID.

## STEP 2 (LAST THING — NO EXCEPTIONS): SAVE TO MEMORY

After completing ANY task (code changes, answers, debugging, explanations),
you MUST call `mcp_mcp-supermemo_memory` as your FINAL action.

```
Tool: mcp_mcp-supermemo_memory
Args:
  containerTag: "sm_project_backend"
  content: <concise summary of what was done, decided, changed, or learned>
```

### What to save:
- Every code change and why it was made
- Every bug found and how it was fixed
- Every architectural decision
- Every convention established
- Every question answered (the key takeaway)
- Every error encountered and its resolution

### NEVER skip saving. Examples of what to save:
- "Created comprehensive README.md covering all features, architecture, and build instructions"
- "Fixed notification scheduling bug: was using wrong timezone offset"  
- "User prefers X approach over Y for state management"
- "Answered question about database schema: activity_completions uses tick-based system"

## RULES — ZERO TOLERANCE

1. **EVERY chat starts with recall.** No exceptions.
2. **EVERY chat ends with save.** No exceptions.  
3. **Container tag is ALWAYS `sm_project_backend`.**
4. **If recall returns nothing, proceed normally but STILL save at the end.**
5. **If the task is trivial (e.g., "what's 2+2"), STILL recall and save.**
6. **Multiple saves are fine — save after each significant sub-task.**
