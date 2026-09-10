"use client";
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import type { Employee, Commitment, View } from "./data";
type Input = {
  team: Employee[];
  commitments: Commitment[];
  goal: string;
  view: View;
  setView: (v: View) => void;
  setChannel: (v: string) => void;
  selectPerson: (id: string) => void;
};
type Registry = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
export function useWorkspaceTools(input: Input) {
  const state = useRef(input);
  state.current = input;
  useEffect(() => {
    const context = (document as Document & { modelContext?: Registry })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools = [
      {
        name: "get_workspace_status",
        title: "Read workspace status",
        description:
          "Read the local demo goal, employees, and commitments. Activity is demo state, not cloud execution.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => ({
          mode: "local_demo",
          goal: state.current.goal,
          view: state.current.view,
          employees: state.current.team.map(
            ({ id, name, role, status, task }) => ({
              id,
              name,
              role,
              status,
              task,
            }),
          ),
          commitments: state.current.commitments,
        }),
      },
      {
        name: "open_employee",
        title: "Open an employee",
        description:
          "Open the visible employee profile for an existing employee ID. Does not start execution.",
        inputSchema: {
          type: "object",
          properties: { employeeId: { type: "string" } },
          required: ["employeeId"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (value: unknown) => {
          if (
            !value ||
            typeof value !== "object" ||
            !("employeeId" in value) ||
            typeof value.employeeId !== "string"
          )
            throw new Error("employeeId must be a string");
          const employee = state.current.team.find(
            (e) => e.id === (value as { employeeId: string }).employeeId,
          );
          if (!employee) throw new Error("Employee not found");
          flushSync(() => state.current.selectPerson(employee.id));
          return { opened: employee.id, name: employee.name };
        },
      },
      {
        name: "start_team_announcement",
        title: "Start a team announcement",
        description:
          "Navigate to Announce and select the whole team. Opens the composer; does not send a message.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: () => {
          flushSync(() => {
            state.current.setChannel("team");
            state.current.setView("Announce");
          });
          return { view: "Announce", audience: "team", sent: false };
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    }
    return () => lifecycle.abort();
  }, []);
}
