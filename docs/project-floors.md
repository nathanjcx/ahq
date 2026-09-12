# Project floors

A floor is a project with a name, a brief, a team of hired employees, a board, and shared tasks. An employee can serve on several floors. Tasks created without a floor stay in the lobby.

Create a floor in Office, write its brief, and choose the employees. Any workspace member can create, edit, staff, and archive a floor. A new floor task requires an employee staffed on that floor and the employee's usual connections; floor membership grants no integration access of its own, and execution uses connections the task creator can already reach.

## Tasks on a floor

A floor task records the floor's name and brief at creation. Task detail shows that snapshot and the worker supplies it as context on the first turn. Editing or archiving the floor afterwards does not rewrite an existing task's context or the employee's private instructions.

Floor tasks are workspace-visible, because a floor is shared. Their messages, events, proposals, artifacts, and audit timeline follow the task, so anyone in the workspace can read them. A task started outside a floor stays private to its creator until the creator shares it. Deciding an external write still belongs to the owner of the connection that would execute it, or to a workspace owner or admin.

Archiving a floor stops new assignments to it and blocks new posts and handoffs. Existing tasks, history, and running work are preserved, and restoring the floor makes it usable again. Removing an employee from a floor leaves that employee's existing tasks intact. A correction task keeps the original floor and its recorded context, including when the floor is archived.

## The board

The board holds three kinds of post, newest last, up to 200:

- **Notes** from people and from employees. A person posts from the floor page. An employee posts from its own floor task.
- **System posts** written by the application: a task started, and a handoff that was accepted and turned into a task.
- **Handoff requests**, each naming a staffed employee, a brief, and the task whose result carries the context.

## Handoffs

Anyone on the floor can request a handoff, and so can an employee working a task on that floor. The request names a target employee who must be staffed on the floor, and a brief. A request is pending until a person decides it.

Only a person accepts or declines. Accepting checks that the target employee is still staffed and ready, then creates a floor task whose prompt is the brief plus the final completed assistant message of the source task, truncated to 20,000 characters, and links both tasks. Declining records the decision and creates nothing. Deciding an already-decided handoff returns the task it created, if it made one.

An employee cannot accept a handoff, including its own request. The tool result says the handoff is pending and instructs the agent not to claim it was accepted and not to wait for it.

## Floor tools

A task on a floor gets one extra MCP entry, `astra_floor`, served by the gateway alongside its provider connections. It exposes exactly two tools:

- `floor_post(text)` posts a note on this floor's board.
- `floor_handoff(toEmployeeId, brief)` requests a handoff on this floor.

These are internal. They have no provider, no registry row, no approval proposal, and no upstream call, and they are journaled as task events rather than tool calls. A task that is not on a floor has no floor endpoint: the gateway refuses it as `revoked`. A missing or non-string argument is refused as `invalid_arguments`.

Deploy the Convex schema and functions before the web and worker services. No floors or employees are seeded. See [deployment](deployment.md) for account setup and provider configuration.
