"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Focus,
  GitBranch,
  Layers3,
  LockKeyhole,
  Maximize2,
  MessageCircle,
  Minus,
  Orbit,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  Users,
  X,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar } from "./shared";
import type { Commitment, Employee, WorkEvent, View } from "./data";

const Office = dynamic(() => import("./office"), {
  ssr: false,
  loading: () => (
    <div className="office-loading">
      <Orbit size={32} />
      <span>Opening headquarters…</span>
    </div>
  ),
});
export type DemoState = { running: boolean; step: number; restorable: boolean };
export type DemoCommand = { id: number; action: "play" | "stop" | "restore" };
type Props = {
  team: Employee[];
  commitments: Commitment[];
  events: WorkEvent[];
  goal: string;
  approved: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onProfile: (id: string) => void;
  onModal: (name: string) => void;
  onView: (view: View) => void;
  onRoom: (room: string) => void;
  motion: boolean;
  onMotion: () => void;
  demo: DemoState;
  onDemo: (action: DemoCommand["action"]) => void;
};
type NodeId = "research" | "story" | "review" | "creative" | "handoff";
const nodeMeta = {
  research: {
    label: "Find the opening",
    role: "Research",
    person: "leo",
    detail:
      "Three market gaps, one useful insight: small teams need a clear next step. Leo’s notes set the direction for the story.",
    action: "Read the team’s exchange",
  },
  story: {
    label: "Make it resonate",
    role: "Narrative",
    person: "iris",
    detail:
      "“Less managing. More making.” Iris turns the research into a product story built around a scattered week becoming a clear path.",
    action: "See the launch story",
  },
  review: {
    label: "Choose the direction",
    role: "Your decision",
    person: "maya",
    detail:
      "Maya has brought the research and narrative into one editable brief. Your approval gives creative and operations their next assignments.",
    action: "Review the launch brief",
  },
  creative: {
    label: "Bring it to life",
    role: "Creative concepts",
    person: "iris",
    detail:
      "Develop launch concepts from the approved direction: the product walkthrough, design partner invitation, and before-and-after workflows.",
    action: "Open Iris’s assignment",
  },
  handoff: {
    label: "Make it happen",
    role: "Launch handoff",
    person: "noah",
    detail:
      "Prepare the final handoff: owners, dependencies, and launch checklist. The overall launch stays in progress until this work is done.",
    action: "Open Noah’s assignment",
  },
};
const chapters = [
  {
    label: "The plan",
    title: "An ambition becomes a plan.",
    line: "Maya brings the team around one clear outcome.",
    person: "maya",
  },
  {
    label: "Research",
    title: "A useful insight changes the story.",
    line: "Leo explores the landscape and finds the opening.",
    person: "leo",
  },
  {
    label: "The handoff",
    title: "One person’s work becomes another’s start.",
    line: "Iris turns Leo’s findings into a launch narrative.",
    person: "iris",
  },
  {
    label: "Your decision",
    title: "The next move belongs to you.",
    line: "Review Maya’s brief to unlock two next assignments.",
    person: "maya",
  },
];

export default function CommandCenter(p: Props) {
  const [mode, setMode] = useState("space");
  const [zoom, setZoom] = useState(39);
  const [angle, setAngle] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [node, setNode] = useState<NodeId>("review");
  const [minutes, setMinutes] = useState("5");
  const [justApproved, setJustApproved] = useState(false);
  const previousApproval = useRef(p.approved);
  const stageRef = useRef<HTMLElement>(null);
  const openModal = (name: string) => {
    setExpanded(false);
    p.onModal(name);
  };
  const openProfile = (id: string) => {
    setExpanded(false);
    p.onProfile(id);
  };
  const launch = p.commitments.find((c) => c.id === "launch");
  const revising =
    !p.approved &&
    launch?.status === "In progress" &&
    launch.progress === 50 &&
    p.team.find((e) => e.id === "maya")?.task.includes("Revision request");
  const person = p.team.find((e) => e.id === p.selected);
  const chapter = chapters[Math.max(0, p.demo.step - 1)];
  useEffect(() => {
    const isNew = p.approved && !previousApproval.current;
    previousApproval.current = p.approved;
    if (!p.approved) {
      setJustApproved(false);
      return;
    }
    if (isNew) {
      setJustApproved(true);
      setMode("flow");
      setNode("creative");
      const t = setTimeout(() => setJustApproved(false), 5000);
      return () => clearTimeout(t);
    }
  }, [p.approved]);
  useEffect(() => {
    if (p.demo.running && p.demo.step) {
      p.onSelect(chapters[p.demo.step - 1].person);
      setNode(
        (["review", "research", "story", "review"] as NodeId[])[
          p.demo.step - 1
        ],
      );
    }
  }, [p.demo.running, p.demo.step, p.onSelect]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    const priorFocus = document.activeElement as HTMLElement | null;
    const hidden = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".hq-sidebar,.topbar,.hq-intro,.story-player,.mission-summary,.moment-section,.lower-workspace,.workspace-footer",
      ),
    ).map((el) => ({ el, inert: el.inert }));
    hidden.forEach(({ el }) => (el.inert = true));
    stageRef.current?.focus();
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
      if (e.key === "Tab") {
        const focusable = Array.from(
          stageRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),[href],input,textarea,[tabindex="0"]',
          ) || [],
        ).filter((el) => el.getClientRects().length);
        const first = focusable[0],
          last = focusable.at(-1);
        if (!first) return;
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === stageRef.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      hidden.forEach(({ el, inert }) => (el.inert = inert));
      if (priorFocus?.isConnected) priorFocus.focus();
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded]);
  function status(id: NodeId) {
    if (id === "review")
      return p.approved
        ? "Approved"
        : revising
          ? "Changes requested"
          : p.demo.running && p.demo.step < 4
            ? "Coming up"
            : "Needs you";
    if (id === "creative" || id === "handoff")
      return p.approved ? "In progress" : "Awaiting direction";
    if (
      p.demo.running &&
      ((id === "research" && p.demo.step < 3) ||
        (id === "story" && p.demo.step < 4))
    )
      return (id === "research" && p.demo.step === 2) ||
        (id === "story" && p.demo.step === 3)
        ? "In progress"
        : "Coming up";
    return "Ready in brief";
  }
  function chooseNode(id: NodeId) {
    setNode(id);
    p.onSelect(nodeMeta[id].person);
  }
  function nodeAction(id: NodeId) {
    if (id === "research") p.onView("Conversations");
    else if (["story", "review"].includes(id)) openModal("review");
    else openProfile(nodeMeta[id].person);
  }
  function renderNode(id: NodeId) {
    const meta = nodeMeta[id],
      state = status(id),
      member = p.team.find((e) => e.id === meta.person) || p.team[0];
    return (
      <button
        key={id}
        className={`mission-node node-${id} ${node === id ? "selected" : ""} ${state === "Approved" || state === "Ready in brief" ? "complete" : ""} ${state === "In progress" ? "active" : ""}`}
        onClick={() => chooseNode(id)}
        aria-pressed={node === id}
      >
        <div className="node-heading">
          <span>{meta.role}</span>
          {state === "Approved" || state === "Ready in brief" ? (
            <Check size={14} />
          ) : id === "review" ? (
            <Focus size={16} />
          ) : ["creative", "handoff"].includes(id) && !p.approved ? (
            <LockKeyhole size={13} />
          ) : (
            <span className="node-pulse" />
          )}
        </div>
        <strong>{meta.label}</strong>
        <div className="node-bottom">
          <Avatar person={member} size="tiny" />
          <span>{member.name}</span>
          <em>{state}</em>
        </div>
      </button>
    );
  }
  return (
    <div className={`command-center ${p.motion ? "with-motion" : ""}`}>
      <section className="hq-intro">
        <div>
          <div className="cc-eyebrow">
            <span /> YOUR PERSONAL HEADQUARTERS
          </div>
          <h1>
            Your ambition, <em>in motion.</em>
          </h1>
          <p>A team that takes it from here. A clear place for you to lead.</p>
        </div>
        <div className="intro-actions">
          <button className="cc-secondary" onClick={() => openModal("goal")}>
            <Target size={16} /> Set direction
          </button>
          <button className="cc-primary" onClick={() => openModal("hire")}>
            <Plus size={17} /> Grow your team
          </button>
        </div>
      </section>
      <section
        className={`mission-stage ${expanded ? "expanded" : ""} ${justApproved ? "celebrating" : ""}`}
        ref={stageRef}
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded || undefined}
        tabIndex={expanded ? -1 : undefined}
        aria-label="Interactive headquarters"
      >
        <header className="stage-header">
          <div className="stage-identity">
            <span className="stage-mark">
              <Orbit size={23} />
            </span>
            <div>
              <strong>THE NORTHSTAR MISSION</strong>
              <span>{p.team.length} people · one shared direction</span>
            </div>
          </div>
          <Tabs value={mode} onValueChange={setMode}>
            <TabsList className="stage-tabs">
              <TabsTrigger value="space">
                <Layers3 size={14} /> Office
              </TabsTrigger>
              <TabsTrigger value="flow">
                <GitBranch size={14} /> Workstream
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <button
            className="stage-expand"
            aria-label={
              expanded ? "Exit immersive view" : "Enter immersive view"
            }
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <X size={18} /> : <Maximize2 size={17} />}
          </button>
        </header>
        <div className="stage-body">
          <div className="stage-world">
            <div className="world-caption">
              <span className="world-floor">
                {mode === "space" ? "01 / THE STUDIO" : "02 / THE WORKSTREAM"}
              </span>
              <span className="world-demo">
                <i /> LOCAL DEMO
              </span>
            </div>
            <div
              className="immersive-scene"
              style={{ visibility: mode === "space" ? "visible" : "hidden" }}
              inert={mode !== "space"}
              aria-hidden={mode !== "space"}
            >
              <Office
                team={p.team}
                selected={p.selected}
                onSelect={p.onSelect}
                motion={p.motion && mode === "space"}
                timeline={50}
                zoom={zoom}
                angle={angle}
                onRoom={p.onRoom}
              />
            </div>
            {mode === "flow" && (
              <div className="mission-map">
                <div className="map-heading">
                  <span>FROM INTENT TO OUTCOME</span>
                  <h2>
                    Good work <em>connects.</em>
                  </h2>
                  <p>Select a step to follow the work.</p>
                </div>
                <div className={`map-nodes ${p.approved ? "unlocked" : ""}`}>
                  <svg
                    className="map-connectors"
                    viewBox="0 0 720 370"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      className="upstream"
                      d="M160 105H235 Q250 105 250 125V190H280"
                    />
                    <path
                      className="upstream"
                      d="M160 280H235 Q250 280 250 260V190H280"
                    />
                    <path
                      className="downstream"
                      d="M445 190H490 Q505 190 505 170V105H552"
                    />
                    <path
                      className="downstream"
                      d="M445 190H490 Q505 190 505 210V280H552"
                    />
                  </svg>
                  {renderNode("research")}
                  {renderNode("story")}
                  {renderNode("review")}
                  {renderNode("creative")}
                  {renderNode("handoff")}
                </div>
                <div className="map-detail">
                  <span className="map-detail-dot" />
                  <div>
                    <strong>{nodeMeta[node].role}</strong>
                    <p>{nodeMeta[node].detail}</p>
                  </div>
                  <button
                    onClick={() => nodeAction(node)}
                    aria-label={nodeMeta[node].action}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </div>
              </div>
            )}
            {mode === "space" && (
              <>
                <div className="world-note">
                  <span className="note-rule" />
                  <span>
                    {p.approved
                      ? "A little direction. A lot of momentum."
                      : "Great things start with the right people."}
                  </span>
                </div>
                <div className="world-controls">
                  <button
                    onClick={p.onMotion}
                    aria-label={
                      p.motion ? "Pause office motion" : "Resume office motion"
                    }
                  >
                    {p.motion ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <i />
                  <button
                    onClick={() => setZoom((v) => Math.max(25, v - 4))}
                    aria-label="Zoom out"
                  >
                    <Minus size={16} />
                  </button>
                  <button
                    onClick={() => setZoom((v) => Math.min(59, v + 4))}
                    aria-label="Zoom in"
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    onClick={() => setAngle((v) => v + 30)}
                    aria-label="Rotate office"
                  >
                    <RotateCcw size={15} />
                  </button>
                </div>
              </>
            )}
            {person && mode === "space" && (
              <div className="focus-card">
                <Avatar person={person} size="small" />
                <div>
                  <strong>
                    {person.name}
                    <span>{person.role}</span>
                  </strong>
                  <p>{person.task}</p>
                </div>
                <button
                  onClick={() => openProfile(person.id)}
                  aria-label={`Open ${person.name} profile`}
                >
                  <ArrowUpRight size={16} />
                </button>
                <button
                  onClick={() => p.onSelect(null)}
                  aria-label="Clear employee focus"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
          <aside className="decision-dock">
            <div className="dock-eyebrow">
              <span className={p.approved ? "green" : ""} />
              {p.approved
                ? "DIRECTION APPROVED"
                : revising
                  ? "CHANGES RECORDED"
                  : p.demo.running
                    ? "THE TEAM IS ON IT"
                    : "THE NEXT MOVE IS YOURS"}
              <ArrowDownRight size={16} />
            </div>
            <h2>
              {p.approved ? (
                <>
                  Two doors,
                  <br />
                  <em>just opened.</em>
                </>
              ) : revising ? (
                <>
                  A new direction
                  <br />
                  <em>starts here.</em>
                </>
              ) : (
                <>
                  Small decision.
                  <br />
                  <em>Big momentum.</em>
                </>
              )}
            </h2>
            <p className="dock-copy">
              {p.approved
                ? "Iris and Noah have their next assignments. The launch is moving forward."
                : revising
                  ? "Your feedback is saved for Maya. A live session can take the revision forward."
                  : "Maya connected the research and the story. Your judgment connects what comes next."}
            </p>
            <button
              className="brief-preview"
              onClick={() => openModal("review")}
              aria-label="Open Northstar launch brief"
            >
              <div className="brief-preview-top">
                <span>NORTHSTAR®</span>
                <ArrowUpRight size={16} />
              </div>
              <div className="brief-orbit" aria-hidden="true">
                <i />
                <i />
                <i />
                <span>✳</span>
              </div>
              <div className="brief-preview-bottom">
                <span>01 — LAUNCH DIRECTION</span>
                <strong>
                  Less managing.
                  <br />
                  More making.
                </strong>
              </div>
              <div className="brief-paper-edge" />
            </button>
            <div className="brief-byline">
              <div className="mini-avatars">
                {p.team
                  .filter((e) => ["maya", "leo", "iris"].includes(e.id))
                  .map((e) => (
                    <Avatar key={e.id} person={e} size="tiny" />
                  ))}
              </div>
              <span>
                Prepared together.
                <br />
                <strong>Ready for your perspective.</strong>
              </span>
            </div>
            <button
              className="decision-cta"
              onClick={() => openModal("review")}
            >
              {p.approved
                ? "Open approved brief"
                : revising
                  ? "Open brief & feedback"
                  : "Review the launch brief"}
              <ArrowRight size={17} />
            </button>
            <div className="decision-footnote">
              <Clock3 size={12} />
              {p.approved ? "Handoff still in progress" : "About 5 min"}
              <span>·</span>
              {p.approved ? "Version saved" : "Unlocks 2 next steps"}
            </div>
          </aside>
        </div>
        <div className="stage-bottom">
          <div className="team-presence">
            <span>IN THE OFFICE</span>
            <div>
              {p.team.slice(0, 7).map((e) => (
                <button
                  key={e.id}
                  onClick={() => p.onSelect(e.id)}
                  className={p.selected === e.id ? "selected" : ""}
                  aria-label={`Focus ${e.name}`}
                >
                  <Avatar person={e} size="tiny" />
                  <span>{e.name}</span>
                  <i className={e.status} />
                </button>
              ))}
            </div>
          </div>
          <button
            className="stage-talk"
            onClick={() => p.onView("Conversations")}
          >
            <MessageCircle size={15} />
            <span>Team conversation</span>
            <ArrowUpRight size={14} />
          </button>
        </div>
        {justApproved && (
          <div className="unlock-banner" role="status">
            <Check size={18} />
            <span>
              Direction approved <b>Creative + Operations are moving.</b>
            </span>
            <button
              onClick={() => {
                setMode("flow");
                setJustApproved(false);
              }}
            >
              Follow the work <ArrowRight size={14} />
            </button>
          </div>
        )}
      </section>
      <section className={`story-player ${p.demo.running ? "playing" : ""}`}>
        <button
          className="story-play"
          onClick={() => p.onDemo(p.demo.running ? "stop" : "play")}
          aria-label={
            p.demo.running ? "Stop mission demo" : "Play mission demo"
          }
        >
          {p.demo.running ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <div className="story-title">
          <span>
            {p.demo.running
              ? "WATCH THE WORK TAKE SHAPE"
              : "A PROMISE BECOMES A PLAN"}
          </span>
          <strong>
            {p.demo.running ? chapter.title : "Take a walk through the work."}
          </strong>
          <p>
            {p.demo.running
              ? chapter.line
              : "A short, interactive mission. Your decision is the final act."}
          </p>
        </div>
        <div className="story-chapters">
          {chapters.map((c, i) => (
            <span key={c.label} className={p.demo.step > i ? "done" : ""}>
              <i>
                {p.demo.step > i ? (
                  <Check size={10} />
                ) : (
                  String(i + 1).padStart(2, "0")
                )}
              </i>
              {c.label}
            </span>
          ))}
        </div>
        {p.demo.restorable && (
          <button
            className="restore-demo"
            onClick={() => p.onDemo("restore")}
            title="Restore workspace from before this demo"
          >
            <RotateCcw size={13} /> Restore
          </button>
        )}
      </section>
      <section className="mission-summary">
        <div className="promise-heading">
          <span className="promise-icon">
            <Target size={21} />
          </span>
          <div>
            <span>THE PROMISE</span>
            <button onClick={() => openModal("goal")}>
              {p.goal}
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
        <div className="promise-progress">
          <span>
            <b>{launch?.progress ?? 0}%</b> taking shape
          </span>
          <div>
            <i style={{ width: `${launch?.progress ?? 0}%` }} />
          </div>
        </div>
        <div className="promise-deadline">
          <Clock3 size={15} />
          <span>
            {launch?.due ?? "Set a deadline"}
            <small>The destination stays. The path adapts.</small>
          </span>
        </div>
      </section>
      <section className="moment-section">
        <div className="moment-heading">
          <div className="cc-eyebrow">A LITTLE TIME GOES A LONG WAY</div>
          <h2>
            Make this moment <em>count.</em>
          </h2>
          <p>Meet your team where they need you.</p>
        </div>
        <div className="moment-action">
          <Tabs value={minutes} onValueChange={setMinutes}>
            <TabsList className="moment-tabs">
              <TabsTrigger value="2">2 minutes</TabsTrigger>
              <TabsTrigger value="5">5 minutes</TabsTrigger>
              <TabsTrigger value="15">15 minutes</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="moment-choice">
            <div>
              <span>
                {p.approved
                  ? "KEEP THE MOMENTUM"
                  : minutes === "2"
                    ? "SHARPEN THE INTENT"
                    : minutes === "5"
                      ? "YOUR HIGHEST IMPACT MOVE"
                      : "SHAPE THE WORK"}
              </span>
              <h3>
                {p.approved
                  ? "Follow the next two assignments."
                  : minutes === "2"
                    ? "Give the team a clearer north star."
                    : minutes === "5"
                      ? "One review. Two people unblocked."
                      : "Put your perspective into the brief."}
              </h3>
              <p>
                {p.approved
                  ? "Creative concepts and the final handoff are ready to move."
                  : minutes === "2"
                    ? "Refine the outcome without changing the promise’s deadline."
                    : minutes === "5"
                      ? "Choose the direction for the launch. Iris and Noah take it from there."
                      : "Edit the story and launch plan before you approve this version."}
              </p>
            </div>
            <button
              aria-label={
                p.approved
                  ? "Follow next assignments"
                  : minutes === "2"
                    ? "Edit team goal"
                    : "Review direction"
              }
              onClick={() => {
                if (p.approved) {
                  setMode("flow");
                  setNode("creative");
                  document.querySelector(".mission-stage")?.scrollIntoView({
                    behavior: p.motion ? "smooth" : "auto",
                  });
                } else openModal(minutes === "2" ? "goal" : "review");
              }}
            >
              <ArrowUpRight size={22} />
            </button>
          </div>
        </div>
      </section>
      <section className="lower-workspace">
        <div className="promises-panel">
          <div className="cc-section-head">
            <h2>
              Promises in motion{" "}
              <span>
                {p.commitments.filter((c) => c.status !== "Completed").length}
              </span>
            </h2>
            <button onClick={() => p.onView("Commitments")}>
              View all <ArrowUpRight size={14} />
            </button>
          </div>
          {p.commitments.slice(0, 3).map((c, i) => (
            <button
              className="promise-row"
              key={c.id}
              onClick={() =>
                c.id === "launch"
                  ? openModal("review")
                  : p.onView("Commitments")
              }
            >
              <span className="promise-number">0{i + 1}</span>
              <div>
                <strong>{c.title}</strong>
                <span>
                  <i className={c.status === "Needs review" ? "review" : ""} />
                  {c.status}
                  <b>·</b>
                  {c.due}
                </span>
              </div>
              <div className="mini-progress">
                <i style={{ width: `${c.progress}%` }} />
              </div>
              <ArrowUpRight size={15} />
            </button>
          ))}
        </div>
        <div className="signal-panel">
          <div className="cc-section-head">
            <h2>Between the desks</h2>
            <span className="signal-badge">
              <span /> TEAM SIGNAL
            </span>
          </div>
          {p.events.slice(0, 3).map((e) => {
            const member = p.team.find((m) => m.id === e.person) || p.team[0];
            return (
              <button
                key={e.id}
                className="signal-row"
                onClick={() =>
                  e.kind === "review"
                    ? openModal("review")
                    : p.onView("Conversations")
                }
              >
                <Avatar person={member} size="small" />
                <div>
                  <p>
                    <strong>{e.person === "you" ? "You" : member.name}</strong>{" "}
                    {e.action.charAt(0).toLowerCase() + e.action.slice(1)}
                  </p>
                  <span>{e.time}</span>
                </div>
                <ChevronRight size={13} />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
