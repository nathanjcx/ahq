"use client";
import type { CSSProperties } from "react";
import { ArrowUpRight, Clock3 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { Employee, Commitment } from "./data";
export function Avatar({
  person,
  size = "normal",
}: {
  person: Employee;
  size?: string;
}) {
  return (
    <span
      className={`avatar ${size}`}
      style={{ "--avatar-color": person.color } as CSSProperties}
    >
      {person.initials}
    </span>
  );
}
export function CommitmentCard({
  commitment: c,
  person,
  onClick,
}: {
  commitment: Commitment;
  person: Employee;
  onClick: () => void;
}) {
  return (
    <button className="commitment-card" onClick={onClick}>
      <div className="commitment-top">
        <span
          className={`commitment-state ${c.status === "Needs review" ? "review" : c.status === "Completed" ? "done" : ""}`}
        >
          <span />
          {c.status}
        </span>
        <ArrowUpRight size={16} />
      </div>
      <h3>{c.title}</h3>
      <Progress value={c.progress} className="commitment-progress" />
      <div className="commitment-bottom">
        <span>
          <Clock3 size={14} />
          {c.due}
        </span>
        <Avatar person={person} size="tiny" />
      </div>
    </button>
  );
}
