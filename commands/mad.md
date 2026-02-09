---
description: Start MAD orchestration - decompose and parallelize a development task
agent: orchestrator
---

# MAD Orchestration Request

I need you to orchestrate parallel development for the following task:

$ARGUMENTS

## Instructions

**FOLLOW THIS WORKFLOW:**

### Phase 1: Planning
1. **Spawn the mad-planner** to clarify requirements
2. The planner will ask questions and create a detailed plan
3. **WAIT for user to say "GO"** before proceeding

### Phase 2: Development  
4. **Create worktrees** with explicit file ownership from the plan
5. **Spawn developer subagents** in parallel using the Task tool
6. **Monitor** progress with mad_status

### Phase 3: Merge
7. **Test** each completed worktree (mad_test)
8. **Merge** one by one (mad_merge)
9. If conflicts → spawn **mad-merger**

### Phase 4: Integration
10. **Final test** on merged code
11. If fails → spawn **mad-fixer**
12. **Cleanup** finished worktrees

**START by spawning the planner. DO NOT skip to development.**
