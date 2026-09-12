# Project floors

Each floor is a project with a name, a brief, and a team of hired employees. An employee can work on several floors. Tasks created without a project stay in the lobby.

Create a floor in Office, write its brief, and choose employees. Assign work from that floor to carry the project into the task. Inbox assignments can also target a floor. A floor can be empty while you prepare its team, but a new project task requires an employee assigned to it and the employee's usual MCP grants.

Workspace members can create, edit, and archive floors. Floor names, briefs, and staffing are shared within the workspace. Task threads, approvals, and artifacts keep their existing creator privacy. Floor membership grants no additional integration access. Execution uses the task creator's authorized connections.

The task records the project name and brief at creation. Task details show that snapshot, and the worker supplies it as user context on the first turn. Editing a floor does not rewrite an existing task's context or private employee instructions. Follow-up messages stay in the same task session.

Archiving a floor stops new ordinary assignments. It preserves the floor, task history, and running work. Removing an employee from a floor also leaves existing tasks intact. Correction tasks retain the original project and context, including when the floor is archived. External actions still follow the existing approval and correction policies.

Deploy the Convex schema and functions before deploying the updated web and worker services. Existing tasks need no data migration because their project reference is optional. No floors or employees are seeded. Follow [deployment](deployment.md) for account setup and service configuration.
