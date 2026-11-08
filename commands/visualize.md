---
description: Visualize the workflow status with ASCII art dashboard
agent: orchestrator
---

# Workflow Visualization

Show me a visual ASCII art dashboard of the current orchestration status.

## Instructions

Use the `status` tool to get the current state of all worktrees, then create a beautiful ASCII visualization showing:

1. **Overall Progress Bar** - Percentage of completed tasks
2. **Worktree Status** - Each worktree with its status icon and details
3. **Timeline** - When tasks were created and completed
4. **Statistics** - Summary counts and metrics

Format the output as a nice ASCII art dashboard with boxes, icons, and progress indicators.

### Example Output Format:

```
┌────────────────────────────────────────────────────────────────┐
│                ORCHESTRATION DASHBOARD                         │
└────────────────────────────────────────────────────────────────┘

📊 Progress: [████████████░░░░░░░░] 60% (3/5 tasks complete)

┌─ Worktree Status ─────────────────────────────────────────────┐
│                                                                │
│  ✅ feat-backend-api                          [DONE]          │
│     └─ 5 commits │ Completed 2h ago                          │
│     └─ Express API with SQLite database                       │
│                                                                │
│  ✅ feat-frontend-ui                          [DONE]          │
│     └─ 7 commits │ Completed 1h ago                          │
│     └─ Vanilla JS timer interface                             │
│                                                                │
│  ⏳ feat-config                              [IN PROGRESS]    │
│     └─ 2 commits │ Active for 30m                            │
│     └─ Package.json and deployment config                     │
│                                                                │
│  🚫 feat-auth                                 [BLOCKED]       │
│     └─ 1 commit │ Blocked for 45m                            │
│     └─ Reason: Waiting for API endpoint design                │
│                                                                │
│  ❌ feat-testing                              [ERROR]         │
│     └─ 3 commits │ Failed 15m ago                            │
│     └─ Error: Tests failing - missing dependency             │
│                                                                │
└────────────────────────────────────────────────────────────────┘

┌─ Timeline ────────────────────────────────────────────────────┐
│                                                                │
│  17:00 │ 🏁 Orchestration started                            │
│  17:05 │ 🔨 5 worktrees created                              │
│  17:35 │ ✅ feat-backend-api completed                        │
│  17:50 │ ✅ feat-frontend-ui completed                        │
│  18:15 │ 🚫 feat-auth blocked                                 │
│  18:20 │ ❌ feat-testing errored                              │
│  18:35 │ 📍 Current time                                      │
│                                                                │
└────────────────────────────────────────────────────────────────┘

┌─ Statistics ──────────────────────────────────────────────────┐
│                                                                │
│  Total Worktrees:     5                                       │
│  ✅ Completed:        2 (40%)                                 │
│  ⏳ In Progress:      1 (20%)                                 │
│  🚫 Blocked:          1 (20%)                                 │
│  ❌ Errors:           1 (20%)                                 │
│                                                                │
│  Total Commits:       18 commits across all branches          │
│  Session Duration:    1h 35m                                  │
│  Average per Task:    19 minutes                              │
│                                                                │
└────────────────────────────────────────────────────────────────┘

💡 Next Actions:
  1. Fix feat-testing error (check .agent-error file)
  2. Unblock feat-auth (provide API endpoint design)
  3. Wait for feat-config to complete
  4. Ready to merge: feat-backend-api, feat-frontend-ui
```

## Customization

You can customize the visualization based on:

- Number of worktrees
- Status distribution
- Available terminal width
- Color support (use emojis for color)

Make it informative, clear, and visually appealing!
