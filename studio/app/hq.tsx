"use client";
import { useEffect, useState, type CSSProperties } from "react";
import CommandCenter, {
  type DemoState,
  type DemoCommand,
} from "./command-center";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Bell,
  CheckCheck,
  ChevronRight,
  Clock3,
  Folder,
  Grip,
  LayoutGrid,
  ListTodo,
  Megaphone,
  MessageCircle,
  Minus,
  Orbit,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sun,
  Target,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarProvider,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Toaster, toast } from "sonner";
import {
  employees,
  initialEvents,
  initialCommitments,
  initialChat,
  launchDraft,
  type Employee,
  type Commitment,
  type WorkEvent,
  type Chat,
  type View,
} from "./data";
import { Avatar, CommitmentCard } from "./shared";
import Workflows from "./workflows";
import { useWorkspaceTools } from "./workspace-tools";
const nav = [
  { name: "Office", icon: LayoutGrid },
  { name: "Employees", icon: Users },
  { name: "Announce", icon: Megaphone },
  { name: "Commitments", icon: ListTodo },
  { name: "Conversations", icon: MessageCircle },
  { name: "Needs you", icon: Bell },
] as const;
export default function Headquarters() {
  const [view, setView] = useState<View>("Office");
  const [team, setTeam] = useState(employees);
  const [selected, setSelected] = useState<string | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const [events, setEvents] = useState(initialEvents);
  const [commitments, setCommitments] = useState(initialCommitments);
  const [chat, setChat] = useState(initialChat);
  const [goal, setGoal] = useState("Make the Northstar launch a great one.");
  const [draft, setDraft] = useState(launchDraft);
  const [approvedDraft, setApprovedDraft] = useState<string | null>(null);
  const [motion, setMotion] = useState(true);
  const [demo, setDemo] = useState<DemoState>({
    running: false,
    step: 0,
    restorable: false,
  });
  const [demoCommand, setDemoCommand] = useState<DemoCommand>({
    id: 0,
    action: "play",
  });
  const [modal, setModal] = useState<string | null>(null);
  const [channel, setChannel] = useState("team");
  const [ready, setReady] = useState(false);
  const needsReview = commitments.filter(
    (c) => c.status === "Needs review",
  ).length;
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ahq-workspace-v1");
      if (saved) {
        const d = JSON.parse(saved);
        if (Array.isArray(d.team) && d.team.length) setTeam(d.team);
        if (Array.isArray(d.commitments)) setCommitments(d.commitments);
        if (Array.isArray(d.chat)) setChat(d.chat);
        if (Array.isArray(d.events)) setEvents(d.events);
        if (typeof d.goal === "string") setGoal(d.goal);
        if (typeof d.draft === "string") setDraft(d.draft);
        if (typeof d.approvedDraft === "string")
          setApprovedDraft(d.approvedDraft);
      }
      if (localStorage.getItem("ahq-demo-in-progress")) {
        localStorage.removeItem("ahq-demo-in-progress");
        const checkpoint = localStorage.getItem("ahq-demo-checkpoint");
        if (checkpoint) {
          const saved = JSON.parse(checkpoint);
          setTeam(saved.team);
          setCommitments(saved.commitments);
          setDraft(saved.draft);
          setApprovedDraft(saved.approvedDraft);
          setChat(saved.chat);
          if (Array.isArray(saved.events)) setEvents(saved.events);
          localStorage.removeItem("ahq-demo-checkpoint");
          toast(
            "The interrupted demo was restored to your previous workspace.",
          );
        } else toast("The demo was interrupted. Replay it to continue.");
      }
    } catch {}
    setReady(true);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches)
      setMotion(false);
  }, []);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem(
          "ahq-workspace-v1",
          JSON.stringify({
            team,
            commitments,
            goal,
            chat,
            events,
            draft,
            approvedDraft,
          }),
        );
      } catch {}
  }, [ready, team, commitments, goal, chat, events, draft, approvedDraft]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setModal((m) => (m === "search" ? null : "search"));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  function addEvent(
    person: string,
    action: string,
    detail: string,
    kind: WorkEvent["kind"] = "work",
  ) {
    setEvents((v) =>
      [
        {
          id: crypto.randomUUID(),
          person,
          action,
          detail,
          time: new Date().toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          }),
          kind,
        },
        ...v,
      ].slice(0, 40),
    );
  }
  function selectPerson(id: string) {
    setSelected(id);
    setProfile(id);
  }
  function room(name: string) {
    if (name === "meeting") {
      setView("Conversations");
      setChannel("team");
    } else if (name === "workspace") setView("Employees");
    else if (name === "library") setView("Resources");
    else toast("The Commons · a little space to think");
  }
  useWorkspaceTools({
    team,
    commitments,
    goal,
    view,
    setView,
    setChannel,
    selectPerson,
  });
  return (
    <SidebarProvider style={{ "--sidebar-width": "218px" } as CSSProperties}>
      <Toaster position="bottom-right" richColors />
      <Sidebar className="hq-sidebar">
        <SidebarHeader>
          <button
            className="brand"
            onClick={() => setView("Office")}
            aria-label="Astra HQ home"
          >
            <span className="brand-icon">
              <Orbit size={27} />
            </span>
            <span>
              astra<span className="brand-hq">hq</span>
            </span>
          </button>
          <div className="workspace-switch">
            <span className="workspace-initial">P</span>
            <div>
              Pablo’s workspace<small>Personal headquarters</small>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <button className="search-button" onClick={() => setModal("search")}>
            <Search size={15} />
            Find anything<kbd>⌘ K</kbd>
          </button>
          <div className="nav-label">WORKSPACE</div>
          <SidebarMenu>
            {nav.map(({ name, icon: Icon }) => (
              <SidebarMenuItem key={name}>
                <SidebarMenuButton
                  onClick={() => {
                    setView(name);
                    if (name === "Announce") setChannel("team");
                  }}
                  isActive={view === name}
                  className="nav-button"
                >
                  <Icon size={18} />
                  <span>{name}</span>
                  {name === "Needs you" && needsReview > 0 && (
                    <b className="nav-count">{needsReview}</b>
                  )}
                  {name === "Employees" && (
                    <span className="nav-number">{team.length}</span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="nav-label team-heading">
            YOUR PEOPLE
            <button aria-label="Hire employee" onClick={() => setModal("hire")}>
              <Plus size={14} />
            </button>
          </div>
          <div className="sidebar-people">
            {team.slice(0, 7).map((p) => (
              <button key={p.id} onClick={() => selectPerson(p.id)}>
                <Avatar person={p} size="tiny" />
                <span>{p.name}</span>
                <i className={`person-status ${p.status}`} />
              </button>
            ))}
          </div>
          <button
            className="resource-link"
            onClick={() => setView("Resources")}
          >
            <Folder size={17} />
            Resources
          </button>
        </SidebarContent>
        <SidebarFooter>
          <div className="demo-status">
            <span className="status-dot" />
            Interactive demo<small>Cloud sessions not connected</small>
          </div>
          <button className="user-button" onClick={() => setModal("settings")}>
            <span className="user-avatar">PZ</span>
            <span>
              Pablo Zavala<small>Workspace owner</small>
            </span>
            <Settings2 size={16} />
          </button>
        </SidebarFooter>
      </Sidebar>
      <main className="hq-main">
        <header className="topbar">
          <div className="breadcrumb">
            <SidebarTrigger className="mobile-toggle" />
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{view}</strong>
          </div>
          <div className="topbar-right">
            <span className="today">
              <Sun size={15} />
              Thursday, September 10
            </span>
            <button
              className="icon-button"
              aria-label="Open needs you"
              onClick={() => setView("Needs you")}
            >
              <Bell size={18} />
              {needsReview > 0 && <i />}
            </button>
            <span className="topbar-avatar">P</span>
          </div>
        </header>
        {view !== "Office" && (
          <div className="page-heading">
            <div>
              <div className="eyebrow">PABLO’S WORKSPACE</div>
              <h1>
                {view === "Needs you"
                  ? "A little input. A lot of progress."
                  : view}
              </h1>
              <p>
                {view === "Employees"
                  ? "Different strengths. One shared direction."
                  : view === "Commitments"
                    ? "Flexibility in the path. Reliability in the promise."
                    : view === "Announce"
                      ? "Set a direction everyone can work toward."
                      : view === "Conversations"
                        ? "The decisions and handoffs behind the work."
                        : view === "Resources"
                          ? "Give your team the context to do good work."
                          : "Review the work that’s ready for your judgment."}
              </p>
            </div>
            <button className="primary-button" onClick={() => setModal("hire")}>
              <Plus size={17} />
              Hire an employee
            </button>
          </div>
        )}
        {view === "Office" && (
          <CommandCenter
            team={team}
            commitments={commitments}
            events={events}
            goal={goal}
            approved={approvedDraft === draft}
            selected={selected}
            onSelect={setSelected}
            onProfile={selectPerson}
            onModal={setModal}
            onView={(next) => {
              setView(next);
              if (next === "Conversations") setChannel("team");
            }}
            onRoom={room}
            motion={motion}
            onMotion={() => setMotion((v) => !v)}
            demo={demo}
            onDemo={(action) =>
              setDemoCommand((v) => ({ id: v.id + 1, action }))
            }
          />
        )}
        {ready && (
          <Workflows
            demoCommand={demoCommand}
            onDemoChange={setDemo}
            view={view}
            setView={setView}
            team={team}
            setTeam={setTeam}
            commitments={commitments}
            setCommitments={setCommitments}
            chat={chat}
            setChat={setChat}
            events={events}
            setEvents={setEvents}
            addEvent={addEvent}
            goal={goal}
            setGoal={setGoal}
            draft={draft}
            setDraft={setDraft}
            approvedDraft={approvedDraft}
            setApprovedDraft={setApprovedDraft}
            modal={modal}
            setModal={setModal}
            profile={profile}
            setProfile={setProfile}
            selectPerson={selectPerson}
            channel={channel}
            setChannel={setChannel}
            motion={motion}
            setMotion={setMotion}
          />
        )}
        <footer className="workspace-footer">
          <span>
            <Orbit size={14} />
            Astra HQ
          </span>
          <span>Good work happens together.</span>
          <button onClick={() => setModal("settings")}>
            Workspace settings
            <Settings2 size={14} />
          </button>
        </footer>
      </main>
    </SidebarProvider>
  );
}
