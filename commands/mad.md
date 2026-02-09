---
description: Start MAD orchestration - decompose and parallelize a development task
agent: orchestrator
---

# MAD Orchestration Request

I need you to orchestrate parallel development for the following task:

$ARGUMENTS

## Instructions

1. **Analyze** the task and identify components that can be developed in parallel
2. **Plan** the decomposition with clear subtasks and branch names
3. **Create worktrees** for each parallelizable subtask
4. **Spawn developer subagents** simultaneously using the Task tool
5. **Monitor** progress with mad_status
6. **Test** each completed worktree before merging
7. **Merge** completed work back to the main branch
8. **Cleanup** finished worktrees

Show me your plan before executing, then proceed with the orchestration.
