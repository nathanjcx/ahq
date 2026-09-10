"use client";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type FormEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  Folder,
  FolderOpen,
  Megaphone,
  MessageCircle,
  Orbit,
  Plus,
  Search,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command";
import { toast } from "sonner";
import { Avatar } from "./shared";
import type { Employee, Commitment, Chat, WorkEvent, View } from "./data";
import type { DemoState, DemoCommand } from "./command-center";
type Setter<T> = Dispatch<SetStateAction<T>>;
type Props = {
  demoCommand: DemoCommand;
  onDemoChange: (state: DemoState) => void;
  view: View;
  setView: Setter<View>;
  team: Employee[];
  setTeam: Setter<Employee[]>;
  commitments: Commitment[];
  setCommitments: Setter<Commitment[]>;
  chat: Chat[];
  setChat: Setter<Chat[]>;
  events: WorkEvent[];
  setEvents: Setter<WorkEvent[]>;
  addEvent: (
    person: string,
    action: string,
    detail: string,
    kind?: WorkEvent["kind"],
  ) => void;
  goal: string;
  setGoal: Setter<string>;
  draft: string;
  setDraft: Setter<string>;
  approvedDraft: string | null;
  setApprovedDraft: Setter<string | null>;
  modal: string | null;
  setModal: Setter<string | null>;
  profile: string | null;
  setProfile: Setter<string | null>;
  selectPerson: (id: string) => void;
  channel: string;
  setChannel: Setter<string>;
  motion: boolean;
  setMotion: Setter<boolean>;
};
function timeNow() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
export default function Workflows(p: Props) {
  const {
    view,
    setView,
    team,
    setTeam,
    commitments,
    setCommitments,
    chat,
    setChat,
    events,
    addEvent,
    goal,
    setGoal,
    draft,
    setDraft,
    approvedDraft,
    setApprovedDraft,
    modal,
    setModal,
    profile,
    setProfile,
    selectPerson,
    channel,
    setChannel,
    motion,
    setMotion,
  } = p;
  const [form, setForm] = useState({
    name: "",
    role: "",
    personality: "",
    skills: "",
  });
  const [goalInput, setGoalInput] = useState(goal);
  const [input, setInput] = useState("");
  const [revision, setRevision] = useState(false);
  const [revisionInput, setRevisionInput] = useState("");
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);
  const [sound, setSound] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [restorable, setRestorable] = useState(false);
  useEffect(() => {
    try {
      setRestorable(!!localStorage.getItem("ahq-demo-checkpoint"));
    } catch {}
  }, []);
  useEffect(
    () => p.onDemoChange({ running: demoRunning, step: demoStep, restorable }),
    [demoRunning, demoStep, restorable, p.onDemoChange],
  );
  useEffect(() => {
    if (!p.demoCommand.id) return;
    if (p.demoCommand.action === "play") playDemo();
    else if (p.demoCommand.action === "restore") restoreDemo();
    else {
      restoreDemo();
    }
  }, [p.demoCommand.id]);
  const fileInput = useRef<HTMLInputElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const demoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const current = team.find((e) => e.id === profile);
  const launch = commitments.find((c) => c.id === "launch");
  const needsReview = commitments.filter(
    (c) => c.status === "Needs review",
  ).length;
  useEffect(() => {
    if (modal === "goal") setGoalInput(goal);
  }, [modal, goal]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      demoTimers.current.forEach(clearTimeout);
    },
    [],
  );
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [chat, channel]);
  function schedule(callback: () => void, ms: number) {
    timers.current.push(setTimeout(callback, ms));
  }
  function stopDemo() {
    demoTimers.current.forEach(clearTimeout);
    demoTimers.current = [];
    setDemoRunning(false);
    try {
      localStorage.removeItem("ahq-demo-in-progress");
    } catch {}
  }
  function updateDraft(value: string) {
    setDraft(value);
    if (approvedDraft !== null && value !== approvedDraft) {
      setApprovedDraft(null);
      setCommitments((v) =>
        v.map((c) =>
          c.id === "launch"
            ? { ...c, status: "Needs review", progress: 50 }
            : c,
        ),
      );
      setTeam((v) =>
        v.map((e) =>
          e.id === "maya"
            ? {
                ...e,
                status: "review",
                task: "The updated launch brief needs a fresh review",
              }
            : ["iris", "noah"].includes(e.id)
              ? {
                  ...e,
                  status: "ready",
                  task: "Waiting for review of the updated direction",
                }
              : e,
        ),
      );
    }
  }
  function speak(text: string) {
    if (sound && "speechSynthesis" in window) {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
  }
  function addEmployee(e: FormEvent) {
    e.preventDefault();
    if (Object.values(form).some((v) => !v.trim())) return;
    const id = crypto.randomUUID();
    const person: Employee = {
      ...form,
      id,
      name: form.name.trim(),
      role: form.role.trim(),
      color: ["#b48661", "#6f9692", "#af7d89"][team.length % 3],
      initials: form.name.slice(0, 2).toUpperCase(),
      task: "Ready for a first assignment",
      status: "ready",
      position: [-1 + ((team.length - 4) % 3) * 1.4, 0, 3.8],
    };
    setTeam((v) => [...v, person]);
    setModal(null);
    setForm({ name: "", role: "", personality: "", skills: "" });
    addEvent(id, "Joined the team", "Ready for a first assignment.");
    setView("Office");
    speak(`${person.name} has joined the team.`);
    toast.success(`${person.name} has joined the office`);
  }
  function suggest() {
    if (!form.role.trim()) {
      toast("Add a job title first");
      return;
    }
    const role = form.role.toLowerCase();
    const creative = /design|creative|brand|writer/.test(role);
    const research = /research|analyst|data/.test(role);
    setForm((v) => ({
      ...v,
      personality: creative
        ? "Imaginative, expressive, and willing to challenge the obvious. Turns complex ideas into clear stories."
        : research
          ? "Curious, rigorous, and quietly persistent. Checks assumptions and makes the evidence easy to understand."
          : "Thoughtful, proactive, and calm under pressure. Takes ownership, communicates clearly, and makes useful progress.",
      skills: creative
        ? "Creative direction, Visual storytelling, Brand strategy, Editing"
        : research
          ? "Research planning, Source verification, Analysis, Evidence synthesis"
          : `${v.role} planning, Research and analysis, Team coordination, Quality review`,
    }));
    toast("A starting point for you to refine");
  }
  function send(e: FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message) return;
    setChat((v) => [
      ...v,
      {
        id: crypto.randomUUID(),
        person: "you",
        text: message,
        channel,
        time: timeNow(),
      },
    ]);
    setInput("");
    const announcing = view === "Announce";
    addEvent(
      "you",
      announcing ? "Announced a new direction" : "Sent a message",
      message,
      "announcement",
    );
    const recipient =
      channel === "team"
        ? team[0]
        : team.find((e) => e.id === channel) || team[0];
    schedule(() => {
      setChat((v) => [
        ...v,
        {
          id: crypto.randomUUID(),
          person: recipient.id,
          text: announcing
            ? `Your announcement is recorded for the team: “${message}”. We can use it as context for the next assignment.`
            : "I’ve recorded your message alongside this assignment. Connect a live session for a working reply, or play the office demo to explore a full handoff.",
          channel,
          time: timeNow(),
        },
      ]);
    }, 650);
    if (announcing) toast.success("Announcement added for your team");
  }
  function approve() {
    if (!draft.trim()) {
      toast.error("Add a direction before approving the brief.");
      return;
    }
    stopDemo();
    setApprovedDraft(draft);
    setCommitments((v) =>
      v.map((c) =>
        c.id === "launch" ? { ...c, status: "In progress", progress: 75 } : c,
      ),
    );
    setTeam((v) =>
      v.map((e) =>
        e.id === "maya"
          ? {
              ...e,
              status: "ready",
              task: "Launch direction approved; brief ready to download",
            }
          : e.id === "iris"
            ? {
                ...e,
                status: "working",
                task: "Developing the approved creative direction",
              }
            : e.id === "noah"
              ? {
                  ...e,
                  status: "working",
                  task: "Preparing the final launch handoff",
                }
              : e,
      ),
    );
    addEvent(
      "maya",
      "Launch direction approved",
      "Creative concepts and the final handoff are unblocked.",
    );
    setChat((v) => [
      ...v,
      {
        id: crypto.randomUUID(),
        person: "maya",
        text: "Direction approved. Iris can develop the creative concepts, and Noah can prepare the final handoff. Your reviewed brief is ready to download.",
        channel: "team",
        time: timeNow(),
      },
    ]);
    setModal(null);
    setView("Office");
    speak("Direction approved. The team has its next step.");
    toast.success("Direction approved · 2 next steps unlocked");
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [`NORTHSTAR / LAUNCH BRIEF\n\nLess managing. More making.\n\n${draft}`],
        { type: "text/plain" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "northstar-launch-brief.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Launch brief downloaded");
  }
  function requestRevision() {
    if (!revisionInput.trim()) return;
    stopDemo();
    setApprovedDraft(null);
    setChat((v) => [
      ...v,
      {
        id: crypto.randomUUID(),
        person: "you",
        text: `Revision requested for the launch brief: ${revisionInput}`,
        channel: "maya",
        time: timeNow(),
      },
    ]);
    setCommitments((v) =>
      v.map((c) =>
        c.id === "launch" ? { ...c, status: "In progress", progress: 50 } : c,
      ),
    );
    setTeam((v) =>
      v.map((e) =>
        e.id === "maya"
          ? {
              ...e,
              status: "ready",
              task: "Revision request recorded; awaiting a live session",
            }
          : ["iris", "noah"].includes(e.id)
            ? {
                ...e,
                status: "ready",
                task: "Waiting for the revised direction",
              }
            : e,
      ),
    );
    addEvent("maya", "Revision requested", revisionInput);
    setRevision(false);
    setRevisionInput("");
    setModal(null);
    toast.success("Revision request saved for Maya");
  }
  function restoreDemo() {
    stopDemo();
    try {
      const raw = localStorage.getItem("ahq-demo-checkpoint");
      if (!raw) return;
      const saved = JSON.parse(raw);
      setTeam(saved.team);
      setCommitments(saved.commitments);
      setDraft(saved.draft);
      setApprovedDraft(saved.approvedDraft);
      setChat(saved.chat);
      if (Array.isArray(saved.events)) p.setEvents(saved.events);
      localStorage.removeItem("ahq-demo-checkpoint");
      setRestorable(false);
      setDemoStep(0);
      toast.success("Your workspace before the demo is restored");
    } catch {
      toast.error("Could not restore this workspace");
    }
  }
  function playDemo() {
    if (demoRunning) return;
    window.scrollTo({ top: 0, behavior: motion ? "smooth" : "auto" });
    try {
      localStorage.setItem("ahq-demo-in-progress", "true");
    } catch {}
    try {
      localStorage.setItem(
        "ahq-demo-checkpoint",
        JSON.stringify({
          team,
          commitments,
          draft,
          approvedDraft,
          chat,
          events,
        }),
      );
      setRestorable(true);
    } catch {}
    setApprovedDraft(null);
    setDemoRunning(true);
    setDemoStep(0);
    setView("Office");
    setModal(null);
    setCommitments((v) =>
      v.map((c) =>
        c.id === "launch" ? { ...c, status: "In progress", progress: 0 } : c,
      ),
    );
    const stages = [
      {
        person: "maya",
        action: "Turned the goal into a plan",
        detail: "Research → narrative → a brief for review.",
        task: "Planning the launch with the team",
        progress: 0,
        kind: "work",
      },
      {
        person: "leo",
        action: "Found three useful opportunities",
        detail: "The research notes are ready for Iris.",
        task: "Researching the competitive landscape",
        progress: 25,
        kind: "work",
      },
      {
        person: "iris",
        action: "Received Leo’s research",
        detail: "Turning the findings into the launch story.",
        task: "Discussing the research with Leo",
        progress: 50,
        kind: "handoff",
      },
      {
        person: "maya",
        action: "The launch brief is ready",
        detail: "Your review unlocks two next steps.",
        task: "Waiting for your review of the launch brief",
        progress: 50,
        kind: "review",
      },
    ] as const;
    stages.forEach((s, i) => {
      demoTimers.current.push(
        setTimeout(
          () => {
            setDemoStep(i + 1);
            addEvent(s.person, s.action, s.detail, s.kind);
            setTeam((v) =>
              v.map((e) =>
                e.id === s.person
                  ? {
                      ...e,
                      status: i === 3 ? "review" : "working",
                      task: s.task,
                    }
                  : e,
              ),
            );
            setCommitments((v) =>
              v.map((c) =>
                c.id === "launch"
                  ? {
                      ...c,
                      status: i === 3 ? "Needs review" : "In progress",
                      progress: s.progress,
                    }
                  : c,
              ),
            );
            setChat((v) => [
              ...v,
              {
                id: crypto.randomUUID(),
                person: s.person,
                text: `${s.action}. ${s.detail}`,
                channel: "team",
                time: timeNow(),
              },
            ]);
            speak(s.action);
            if (i === 3) {
              setDemoRunning(false);
              try {
                localStorage.removeItem("ahq-demo-in-progress");
              } catch {}
              toast.success("The brief is ready. Your move.");
            }
          },
          i * 6200 + 400,
        ),
      );
    });
  }
  return (
    <>
      {view === "Employees" && (
        <div className="employee-grid">
          {team.map((e) => (
            <button
              className="employee-card"
              key={e.id}
              onClick={() => selectPerson(e.id)}
            >
              <div className="employee-card-top">
                <Avatar person={e} size="large" />
                <span className={`status-chip ${e.status}`}>
                  {e.status === "review"
                    ? "Needs you"
                    : e.status === "working"
                      ? "At work"
                      : "Ready"}
                </span>
              </div>
              <h2>{e.name}</h2>
              <span>{e.role}</span>
              <p>{e.personality}</p>
              <div className="employee-task">
                <span className="status-dot" />
                {e.task}
              </div>
              <span className="employee-open">
                Meet {e.name}
                <ArrowUpRight size={17} />
              </span>
            </button>
          ))}
          <button className="hire-card" onClick={() => setModal("hire")}>
            <span>
              <Plus size={25} />
            </span>
            <h3>Room for one more.</h3>
            <p>
              Every good team starts
              <br />
              with the right people.
            </p>
            <b>
              Hire an employee
              <ArrowRight size={15} />
            </b>
          </button>
        </div>
      )}
      {(view === "Announce" || view === "Conversations") && (
        <div className="conversation-layout">
          <aside className="conversation-channels">
            <div className="nav-label">CONVERSATIONS</div>
            <button
              className={channel === "team" ? "active" : ""}
              onClick={() => setChannel("team")}
            >
              <Megaphone size={17} />
              The whole team
            </button>
            {team.map((e) => (
              <button
                className={channel === e.id ? "active" : ""}
                key={e.id}
                onClick={() => {
                  setChannel(e.id);
                  setView("Conversations");
                }}
              >
                <Avatar person={e} size="tiny" />
                {e.name}
              </button>
            ))}
          </aside>
          <section className="chat-panel">
            <div className="chat-heading">
              <span className="goal-icon">
                {channel === "team" ? (
                  <Megaphone size={21} />
                ) : (
                  <MessageCircle size={21} />
                )}
              </span>
              <div>
                <h2>
                  {channel === "team"
                    ? "Everyone, together"
                    : team.find((e) => e.id === channel)?.name}
                </h2>
                <p>
                  {channel === "team"
                    ? `${team.length} people · ideas, decisions, and handoffs`
                    : team.find((e) => e.id === channel)?.role}
                </p>
              </div>
            </div>
            {view === "Announce" && (
              <div className="chat-goal">
                <Target size={18} />
                <span>{goal}</span>
                <button onClick={() => setModal("goal")}>Edit goal</button>
              </div>
            )}
            <div className="chat-messages">
              {chat
                .filter((c) => c.channel === channel)
                .map((c) => {
                  const e = team.find((e) => e.id === c.person);
                  return (
                    <div className="chat-message" key={c.id}>
                      {e ? (
                        <Avatar person={e} />
                      ) : (
                        <span className="avatar you-avatar">PZ</span>
                      )}
                      <div>
                        <header>
                          <strong>{e?.name || "You"}</strong>
                          <span>{e?.role || "Workspace owner"}</span>
                          <time>{c.time}</time>
                        </header>
                        <p>{c.text}</p>
                      </div>
                    </div>
                  );
                })}
              {chat.filter((c) => c.channel === channel).length === 0 && (
                <div className="chat-empty">
                  <MessageCircle size={32} />
                  <h3>A good conversation starts here.</h3>
                  <p>
                    Ask a question, share context, or give a little direction.
                  </p>
                </div>
              )}
              <div ref={messagesEnd} />
            </div>
            {channel === "team" && (
              <button
                className="chat-artifact"
                onClick={() => setModal("review")}
              >
                <FileText size={20} />
                <span>
                  Northstar launch brief
                  <small>Prepared by Maya · editable draft</small>
                </span>
                <ArrowUpRight size={17} />
              </button>
            )}
            <form onSubmit={send} className="composer">
              <textarea
                aria-label={view === "Announce" ? "Announcement" : "Message"}
                placeholder={
                  view === "Announce"
                    ? "Give your team a direction…"
                    : "Share a thought with the team…"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(e);
                  }
                }}
              />
              <div>
                <span>
                  {view === "Announce"
                    ? "Everyone hears this."
                    : "Enter to send · Shift + Enter for a new line"}
                </span>
                <button
                  className="send-button"
                  aria-label="Send message"
                  disabled={!input.trim()}
                >
                  <ArrowUp size={18} />
                </button>
              </div>
            </form>
            <p className="demo-footnote">
              Demo conversations stay in this browser. Live sessions are not
              connected.
            </p>
          </section>
        </div>
      )}
      {view === "Commitments" && (
        <section className="commitments-page">
          <div className="section-top">
            <h2>The work you’ve promised.</h2>
            <button
              className="secondary-button"
              onClick={() => setModal("commitment")}
            >
              <Plus size={16} />
              Add a commitment
            </button>
          </div>
          {commitments.map((c) => (
            <div className="promise-row" key={c.id}>
              <div className="promise-main">
                <span
                  className={`promise-check ${c.status === "Completed" ? "done" : ""}`}
                >
                  {c.status === "Completed" ? (
                    <Check size={19} />
                  ) : (
                    <Target size={19} />
                  )}
                </span>
                <div>
                  <h3>{c.title}</h3>
                  <p>{c.description}</p>
                  <span className="due-line">
                    <Clock3 size={14} />
                    {c.due}
                  </span>
                </div>
                <Avatar
                  person={team.find((e) => e.id === c.owner) || team[0]}
                />
                <span
                  className={`status-chip ${c.status === "Needs review" ? "review" : ""}`}
                >
                  {c.status}
                </span>
              </div>
              <div className="promise-steps">
                {c.steps.map((s, i) => (
                  <div
                    key={s}
                    className={
                      i < Math.floor(c.progress / 25) ? "complete" : ""
                    }
                  >
                    <span>
                      {i < Math.floor(c.progress / 25) ? (
                        <Check size={12} />
                      ) : (
                        i + 1
                      )}
                    </span>
                    {s}
                  </div>
                ))}
              </div>
              <button
                className="text-button"
                onClick={() =>
                  c.id === "launch" ? setModal("review") : selectPerson(c.owner)
                }
              >
                Open work
                <ArrowUpRight size={14} />
              </button>
            </div>
          ))}
        </section>
      )}
      {view === "Needs you" && (
        <section className="needs-page">
          {needsReview ? (
            <>
              <div className="review-intro">
                <span className="large-bell">
                  <Bell size={30} />
                </span>
                <h2>One good decision from you.</h2>
                <p>
                  The research is done. The story is taking shape.
                  <br />
                  Your review unlocks creative concepts and the final handoff.
                </p>
              </div>
              <div className="approval-preview">
                <div className="document-mini">
                  <FileText size={25} />
                  <span>NORTHSTAR / LAUNCH BRIEF</span>
                  <h3>
                    Less managing.
                    <br />
                    More making.
                  </h3>
                  <p>
                    A product-led launch for teams with
                    <br />
                    ambitious work and a full plate.
                  </p>
                  <div />
                  <div />
                  <div />
                </div>
                <div className="approval-summary">
                  <span className="status-chip review">Ready for review</span>
                  <h2>The Northstar launch brief</h2>
                  <p>
                    Approve the direction so Iris can develop the concepts and
                    Noah can prepare the final handoff.
                  </p>
                  <div className="review-by">
                    <Avatar person={team[0]} />
                    <span>
                      Prepared by Maya<small>With Leo and Iris</small>
                    </span>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => setModal("review")}
                  >
                    Review the brief
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <CheckCheck size={44} />
              <h2>
                {approvedDraft === draft
                  ? "Everything has your direction."
                  : "Nothing needs your review yet."}
              </h2>
              <p>
                {approvedDraft === draft
                  ? "The approved brief is ready for your next step."
                  : "Work in progress will appear here when it’s ready."}
              </p>
              {approvedDraft === draft && (
                <button className="secondary-button" onClick={download}>
                  <ArrowDownToLine size={17} />
                  Download approved brief
                </button>
              )}
            </div>
          )}
        </section>
      )}
      {view === "Resources" && (
        <section className="resources-page">
          <div className="resource-folder">
            <FolderOpen size={36} />
            <h2>A shared place to start.</h2>
            <p>
              Select a project folder to preview its file list locally.
              <br />
              Files stay on your device in this demo.
            </p>
            <button
              className="primary-button"
              onClick={() => fileInput.current?.click()}
            >
              <Plus size={17} />
              Choose a folder
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              {...({ webkitdirectory: "" } as Record<string, string>)}
              onChange={(e) => {
                setFiles(
                  Array.from(e.target.files || []).map((f) => ({
                    name: f.webkitRelativePath || f.name,
                    size: f.size,
                  })),
                );
                toast.success("Folder added to your local preview");
              }}
            />
          </div>
          {files.length > 0 && (
            <div className="file-list">
              <h3>{files.length} files · local preview</h3>
              {files.slice(0, 100).map((f) => (
                <div key={f.name}>
                  <FileText size={16} />
                  <span>{f.name}</span>
                  <small>{(f.size / 1024).toFixed(1)} KB</small>
                </div>
              ))}
              {files.length > 100 && <p>Showing the first 100 files.</p>}
            </div>
          )}
          <h2 className="connections-title">Bring your work together.</h2>
          <div className="integration-grid">
            {[
              {
                name: "Slack",
                letter: "#",
                color: "#56364f",
                text: "Channels and team context",
              },
              {
                name: "Gmail",
                letter: "M",
                color: "#bd6355",
                text: "Conversations and draft emails",
              },
              {
                name: "Calendar",
                letter: "31",
                color: "#6484b4",
                text: "Time, availability, and commitments",
              },
              {
                name: "Linear",
                letter: "◒",
                color: "#7778aa",
                text: "Projects, issues, and progress",
              },
            ].map((i) => (
              <div className="integration" key={i.name}>
                <span style={{ color: i.color }}>{i.letter}</span>
                <h3>{i.name}</h3>
                <p>{i.text}</p>
                <button
                  className="secondary-button"
                  onClick={() =>
                    toast(
                      `${i.name} needs an account connection. This local preview does not access your account.`,
                    )
                  }
                >
                  Not connected
                  <Plus size={13} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      <Dialog
        open={modal === "hire"}
        onOpenChange={(v) => {
          if (!v) setModal(null);
        }}
      >
        <DialogContent className="hire-dialog">
          <DialogHeader>
            <span className="dialog-symbol">
              <Users size={23} />
            </span>
            <DialogTitle>A new mind on your team.</DialogTitle>
            <DialogDescription>
              Give them a name, a role, and a little personality.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={addEmployee} className="hire-form">
            <div className="form-two">
              <label>
                Name
                <input
                  autoComplete="off"
                  placeholder="e.g. Alex"
                  required
                  maxLength={40}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                Job title
                <input
                  placeholder="e.g. Growth Strategist"
                  required
                  maxLength={80}
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                />
              </label>
            </div>
            <button type="button" className="suggest-button" onClick={suggest}>
              <Sparkles size={15} />
              Help shape their profile<span>Suggested starting point</span>
            </button>
            <label>
              Personality
              <textarea
                placeholder="What are they like to work with?"
                required
                maxLength={600}
                value={form.personality}
                onChange={(e) =>
                  setForm({ ...form, personality: e.target.value })
                }
              />
            </label>
            <label>
              Skills
              <textarea
                placeholder="What should they be great at?"
                required
                maxLength={600}
                value={form.skills}
                onChange={(e) => setForm({ ...form, skills: e.target.value })}
              />
            </label>
            <div className="form-footer">
              <small>Their next step is onboarding.</small>
              <button className="primary-button">
                <Plus size={16} />
                Welcome to the team
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Sheet
        open={!!profile}
        onOpenChange={(v) => {
          if (!v) setProfile(null);
        }}
      >
        <SheetContent className="employee-sheet">
          {current && (
            <>
              <SheetHeader>
                <Avatar person={current} size="large" />
                <SheetTitle>{current.name}</SheetTitle>
                <SheetDescription>{current.role}</SheetDescription>
              </SheetHeader>
              <div className="sheet-body">
                <span className={`status-chip ${current.status}`}>
                  {current.status === "review"
                    ? "Needs your input"
                    : current.status === "working"
                      ? "At work"
                      : "Ready for what’s next"}
                </span>
                <div className="assignment-box">
                  <small>ON THEIR DESK</small>
                  <h3>{current.task}</h3>
                  <button
                    className="text-button"
                    onClick={() => {
                      setProfile(null);
                      if (current.id === "maya") setModal("review");
                      else setView("Commitments");
                    }}
                  >
                    See the work
                    <ArrowUpRight size={15} />
                  </button>
                </div>
                <div className="profile-section">
                  <h3>Latest activity</h3>
                  <p>
                    {events.find((e) => e.person === current.id)?.action ||
                      "Ready for a first assignment"}
                  </p>
                </div>
                <div className="profile-section">
                  <h3>Personality</h3>
                  <p>{current.personality}</p>
                </div>
                <div className="profile-section">
                  <h3>Skills</h3>
                  <div className="skill-tags">
                    {current.skills.split(",").map((s) => (
                      <span key={s}>{s.trim()}</span>
                    ))}
                  </div>
                </div>
                <div className="profile-section">
                  <h3>Onboarding</h3>
                  <div className="onboarding-row">
                    <CheckCheck size={17} />
                    Employee profile is ready
                  </div>
                  <div className="onboarding-row">
                    <CheckCheck size={17} />
                    Workspace goal is available
                  </div>
                  <div className="onboarding-row pending">
                    <Orbit size={17} />
                    Connect an Astra cloud session
                  </div>
                  <button
                    className="onboarding-row pending"
                    onClick={() => {
                      setProfile(null);
                      setView("Resources");
                    }}
                  >
                    <Folder size={17} />
                    Add project resources
                    <ArrowUpRight size={13} />
                  </button>
                </div>
                <button
                  className="primary-button full-width"
                  onClick={() => {
                    setChannel(current.id);
                    setProfile(null);
                    setView("Conversations");
                  }}
                >
                  <MessageCircle size={17} />
                  Talk to {current.name}
                </button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <Dialog
        open={modal === "review"}
        onOpenChange={(v) => {
          if (!v) {
            setModal(null);
            setRevision(false);
          }
        }}
      >
        <DialogContent className="review-dialog">
          <DialogHeader>
            <span className="eyebrow">READY WHEN YOU ARE</span>
            <DialogTitle>Choose the launch direction.</DialogTitle>
            <DialogDescription>
              Your perspective is the missing piece. Approve this version to
              move the work forward.
            </DialogDescription>
          </DialogHeader>
          <div className="review-workspace">
            <div className="review-document">
              <div className="document-masthead">
                <span>NORTHSTAR</span>
                <span>LAUNCH STRATEGY / 01</span>
              </div>
              <h2>
                Less managing.
                <br />
                <em>More making.</em>
              </h2>
              <div className="document-divider" />
              <label className="sr-only" htmlFor="review-draft">
                Launch brief text
              </label>
              <textarea
                id="review-draft"
                value={draft}
                onChange={(e) => updateDraft(e.target.value)}
                aria-label="Editable launch brief"
              />
              <div className="document-attribution">
                <Avatar person={team[0]} size="tiny" />
                Prepared by Maya · demo project
              </div>
            </div>
            <aside className="decision-preview">
              <span className="review-preview-label">
                WHAT YOUR DECISION MAKES POSSIBLE
              </span>
              <h3>
                {revision ? (
                  <>
                    A stronger direction.
                    <br />
                    <em>Another look.</em>
                  </>
                ) : (
                  <>
                    One decision.
                    <br />
                    <em>Two next steps.</em>
                  </>
                )}
              </h3>
              <div className="decision-origin">
                <Avatar
                  person={team.find((e) => e.id === "maya") || team[0]}
                  size="small"
                />
                <div>
                  <strong>The launch brief</strong>
                  <span>
                    {approvedDraft === draft
                      ? "This version is approved"
                      : "Ready for your perspective"}
                  </span>
                </div>
                <FileText size={17} />
              </div>
              <div className={`decision-branches ${revision ? "changes" : ""}`}>
                {(revision
                  ? [
                      [
                        "maya",
                        "Revisit the direction",
                        "Your feedback, recorded for Maya",
                      ],
                    ]
                  : [
                      [
                        "iris",
                        "Creative concepts",
                        "Develop the approved story",
                      ],
                      [
                        "noah",
                        "Launch handoff",
                        "Owners, dependencies, next steps",
                      ],
                    ]
                ).map(([id, title, detail]) => (
                  <div className="decision-branch" key={id}>
                    <Avatar
                      person={team.find((e) => e.id === id) || team[0]}
                      size="small"
                    />
                    <div>
                      <strong>{title}</strong>
                      <span>{detail}</span>
                    </div>
                    {!revision && <ArrowUpRight size={14} />}
                  </div>
                ))}
              </div>
              <p>
                {revision
                  ? "The revision request is saved locally for a connected session to pick up."
                  : "The launch stays in progress. Your approval clears the direction for creative and operations."}
              </p>
              <div className="review-version-note">
                <CheckCheck size={16} />
                <span>
                  {approvedDraft === draft
                    ? "Approved version saved."
                    : "Your edits stay in this version."}
                  <small>Demo workflow · saved on this device</small>
                </span>
              </div>
            </aside>
          </div>
          {revision && (
            <div className="revision-form">
              <label>
                What would make this stronger?
                <textarea
                  value={revisionInput}
                  onChange={(e) => setRevisionInput(e.target.value)}
                  placeholder="Share a specific change…"
                />
              </label>
              <button
                className="secondary-button"
                disabled={!revisionInput.trim()}
                onClick={requestRevision}
              >
                Save revision request
                <ArrowRight size={15} />
              </button>
            </div>
          )}
          <div className="review-actions">
            <button
              className="icon-button"
              aria-label="Download brief"
              onClick={download}
            >
              <ArrowDownToLine size={18} />
            </button>
            <button
              className="secondary-button"
              onClick={() => setRevision(!revision)}
            >
              Request changes
            </button>
            <button
              className="primary-button"
              onClick={approve}
              disabled={!draft.trim()}
            >
              <Check size={17} />
              {approvedDraft === draft
                ? "Keep approved"
                : "Approve this version"}
            </button>
          </div>
          <p className="demo-footnote">
            Approval saves your decision here. Nothing is sent externally.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog
        open={modal === "goal"}
        onOpenChange={(v) => {
          if (!v) setModal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Give the team a north star.</DialogTitle>
            <DialogDescription>
              A clear outcome leaves room for their best work.
            </DialogDescription>
          </DialogHeader>
          <form
            className="hire-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!goalInput.trim()) return;
              setGoal(goalInput.trim());
              setModal(null);
              addEvent(
                "you",
                "Updated the overarching goal",
                goalInput,
                "announcement",
              );
              toast.success("Your team has a new direction");
            }}
          >
            <label>
              Overarching goal
              <textarea
                required
                maxLength={300}
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
              />
            </label>
            <button className="primary-button">
              Set the direction
              <ArrowRight size={16} />
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={modal === "settings"}
        onOpenChange={(v) => {
          if (!v) setModal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make yourself at home.</DialogTitle>
            <DialogDescription>
              Your preferences for this workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="setting-row">
            <div>
              <strong>Office motion</strong>
              <p>Let employees move around the space.</p>
            </div>
            <Switch
              aria-label="Office motion"
              checked={motion}
              onCheckedChange={setMotion}
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Spoken updates</strong>
              <p>Read demo updates with your device’s voice.</p>
            </div>
            <Switch
              aria-label="Spoken updates"
              checked={sound}
              onCheckedChange={(v) => {
                setSound(v);
                if (v && "speechSynthesis" in window) {
                  speechSynthesis.speak(
                    new SpeechSynthesisUtterance(
                      "Welcome to Astra HQ. Your team is ready.",
                    ),
                  );
                }
              }}
            />
          </div>
          <div className="runtime-note">
            <Orbit size={21} />
            <div>
              <strong>Astra cloud sessions</strong>
              <p>
                Employee activity is a demo scenario. Live sessions and account
                connections are not configured yet.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={modal === "commitment"}
        onOpenChange={(v) => {
          if (!v) setModal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What are we promising?</DialogTitle>
            <DialogDescription>
              Start with the outcome. The path can stay flexible.
            </DialogDescription>
          </DialogHeader>
          <form
            className="hire-form"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              const title = String(d.get("title")).trim();
              if (!title) return;
              const dueDate = new Date(String(d.get("due")));
              setCommitments((v) => [
                ...v,
                {
                  id: crypto.randomUUID(),
                  title,
                  description: String(d.get("description")).trim(),
                  due: dueDate.toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }),
                  owner: team[0].id,
                  status: "In progress",
                  progress: 0,
                  steps: [
                    "Clarify the outcome",
                    "Gather context",
                    "Prepare the work",
                    "Review together",
                  ],
                },
              ]);
              setModal(null);
              addEvent("you", "Added a commitment", title);
              toast.success("Commitment added");
            }}
          >
            <label>
              Promised outcome
              <input
                name="title"
                required
                maxLength={120}
                placeholder="e.g. Prepare the client’s weekly update"
              />
            </label>
            <label>
              What does done look like?
              <textarea name="description" required maxLength={600} />
            </label>
            <label>
              Due
              <input name="due" type="datetime-local" required />
            </label>
            <button className="primary-button">
              <Plus size={16} />
              Add commitment
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={modal === "search"}
        onOpenChange={(v) => {
          if (!v) setModal(null);
        }}
      >
        <DialogContent className="search-dialog">
          <DialogHeader>
            <DialogTitle>Find your way.</DialogTitle>
            <DialogDescription>
              Jump to a person or a part of your workspace.
            </DialogDescription>
          </DialogHeader>
          <Command className="search-command">
            <CommandInput placeholder="Search people and places…" />
            <CommandList>
              <CommandEmpty>No matching people or places.</CommandEmpty>
              <CommandGroup heading="Workspace">
                {(
                  [
                    "Office",
                    "Employees",
                    "Announce",
                    "Commitments",
                    "Conversations",
                    "Needs you",
                    "Resources",
                  ] as View[]
                ).map((v) => (
                  <CommandItem
                    key={v}
                    onSelect={() => {
                      setView(v);
                      setModal(null);
                    }}
                  >
                    <ArrowUpRight size={15} />
                    {v}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Your people">
                {team.map((e) => (
                  <CommandItem
                    key={e.id}
                    value={`${e.name} ${e.role}`}
                    onSelect={() => {
                      selectPerson(e.id);
                      setModal(null);
                    }}
                  >
                    <Avatar person={e} size="tiny" />
                    {e.name}
                    <small>{e.role}</small>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
