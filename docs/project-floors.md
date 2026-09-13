# Floors

Floors are described in [architecture](architecture.md): the domain model under
[Floors and projects](architecture.md#floors-and-projects), the board and its posts under
[Channels and posts](architecture.md#channels-and-posts), and `astra_floor` under
[Internal MCP servers and the role matrix](architecture.md#internal-mcp-servers-and-the-role-matrix).
A floor is now a place with a team; the plan it serves is a project, which spans floors.

Four floor rules live nowhere else:

- A floor task records the floor's name and brief at creation. Editing or archiving the floor
  afterwards does not rewrite an existing task's recorded context.
- Archiving a floor stops new assignments and refuses new posts and handoffs
  (`convex/lib/posts.ts`). Existing tasks, history, and running work are preserved, and restoring the
  floor makes it usable again.
- A person accepts or declines a handoff from the board. A floor whose handoff policy is `auto`
  accepts one the moment an employee requests it, in the name of the person who owns the source task;
  the default, `ask`, waits for a person. Accepting checks
  that the target is still staffed and ready, then creates a floor task whose prompt is the brief plus
  the source task's final completed assistant message, truncated to 20,000 characters, and links both
  tasks. Deciding an already-decided handoff returns the task it created, if it made one.
- Floor membership grants no integration access. A floor task still runs on connections its creator
  can already reach.
