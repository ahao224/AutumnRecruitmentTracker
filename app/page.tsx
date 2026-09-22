"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect, react-hooks/purity, jsx-a11y/no-autofocus, jsx-a11y/no-static-element-interactions */

import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import "./process-fixes.css";

const API = "http://localhost:4311/api";
const statuses = ["准备投递", "已投递", "笔试", "面试", "OC", "Offer", "拒绝", "放弃"];
const priorityRanks: Record<string, number> = { "高": 0, "中": 1, "低": 2 };
const progressRanks: Record<string, number> = { "Offer": 0, "OC": 1, "面试": 2, "笔试": 3, "放弃": 4, "拒绝": 5, "已投递": 6, "准备投递": 7 };
const rejectionStages = ["初筛挂", "笔试挂", "测评挂", "一面挂", "二面挂", "三面挂"];
const sessionTypes = ["AI面试", "测评", "笔试", "面试"];
const interviewRounds = ["技术一面", "技术二面", "技术三面", "HR面", "终面"];
const examRounds = ["在线笔试", "线下笔试", "编程测评", "性格测评"];
const aiInterviewRounds = ["AI面试", "AI技术面试", "AI综合面试"];
const assessmentRounds = ["在线测评", "性格测评", "能力测评", "专业测评"];
const navItems = [
  ["overview", "⌂", "总览"], ["board", "▦", "投递总览"], ["applications", "▤", "投递管理"], ["sessions", "✎", "招聘流程"],
  ["calendar", "□", "日程"], ["insights", "↗", "数据复盘"], ["ai", "✦", "AI 助手"], ["resumes", "◈", "我的简历"], ["trash", "♲", "回收站"], ["data", "◇", "数据与备份"],
] as const;

type Application = Record<string, string | number> & { id: string; company: string; role: string; status: string; rejection_stage: string; priority: string };
type Session = Record<string, string | number> & { id: string; application_id: string; company: string; role: string; type: string; round: string; scheduled_at: string; result: string };
type Question = { id?: string; content: string; answer: string; reference_answer: string; category: string; needs_review: number | boolean };
type SessionDetail = Session & { questions: Question[]; attachments: { id: string; original_name: string; mime_type: string; size: number }[] };
type Resume = { id: string; title: string; version: string; target_role: string; notes: string; original_name: string; mime_type: string; size: number; is_default: number; created_at: string };
type ScheduleEvent = { id: string; application_id: string; title: string; event_type: string; scheduled_at: string; location: string; reminder: string; notes: string; completed: number; company?: string; role?: string };
type LinkCheckResult = { id: string; company: string; role: string; url: string; status: "valid" | "invalid" | "closed" | "review"; label: string; message: string; http_status?: number; inspection_method?: "browser" };
type AiConfig = { provider: "openai" | "openai-compatible"; model: string; base_url: string; configured: boolean; key_source: "" | "local" | "environment"; config_path?: string };
type AiSource = { type: string; id: string; label: string };
type AiConversation = { id: string; title: string; application_id: string; resume_id: string; company?: string; role?: string; resume_title?: string; resume_version?: string; last_message?: string; message_count: number; updated_at: string };
type AiMessage = { id: string; conversation_id: string; role: "user" | "assistant"; content: string; sources: AiSource[]; created_at: string };
type AiJobAnalysis = {
  summary: string;
  fit_assessment: string;
  responsibilities: string[];
  core_skills: string[];
  resume_suggestions: string[];
  interview_questions: string[];
  preparation_checklist: string[];
  generated_at?: string;
  provider?: string;
  model?: string;
  resume_id?: string;
  resume_title?: string;
};

const emptyApp = { company: "", role: "", location: "", channel: "", apply_url: "", applied_at: "", status: "准备投递", rejection_stage: "", priority: "中", salary: "", jd: "", referral: "", resume_version: "", resume_id: "", notes: "", ai_analysis: "" };
const emptySession = { application_id: "", type: "面试", round: "技术一面", scheduled_at: "", duration: "60", format: "视频", location: "", interviewer: "", result: "待进行", notification_date: "", overall_notes: "", improvements: "", rating: "0", questions: [] as Question[] };
const emptySchedule = { application_id: "", title: "", event_type: "投递截止", scheduled_at: "", location: "", reminder: "提前1天", notes: "", completed: 0 };

async function request(path: string, options?: RequestInit) {
  const response = await fetch(`${API}${path}`, { headers: { "Content-Type": "application/json", ...(options?.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "操作失败");
  return body;
}
function formatDate(value: string, withTime = true) {
  if (!value) return "待安排";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(date);
}
function todayLocalDate() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function parseDateOnly(value: string) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}
function dateOnlyKey(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function dateOnlyLabel(value: string) {
  return value ? value.replace(/-/g, "/") : "选择日期";
}
function todayGreeting() { const hour = new Date().getHours(); return hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好"; }
function displayStatus(app: Application) { return app.status === "拒绝" && app.rejection_stage ? `拒绝 · ${app.rejection_stage}` : app.status; }
function sessionTypeClass(type: string) {
  if (type === "笔试") return "exam";
  if (type === "AI面试") return "ai-interview";
  if (type === "测评") return "assessment";
  return "interview";
}
function externalUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try { const url = new URL(candidate); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; }
  catch { return ""; }
}
function parseAiJobAnalysis(value: unknown): AiJobAnalysis | null {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && typeof parsed.summary === "string" ? parsed as AiJobAnalysis : null;
  } catch { return null; }
}
function sessionEndTimestamp(session: Session) {
  const start = +new Date(session.scheduled_at || "");
  if (!Number.isFinite(start)) return 0;
  return start + Math.max(0, Number(session.duration) || 0) * 60_000;
}
function sessionDisplayResult(session: Session, now: number) {
  const end = sessionEndTimestamp(session);
  if (session.result === "待进行" && end > 0 && end <= now) return "已完成（待结果）";
  return session.result || "待定";
}
function applicationStage(app: Application, items: Session[], now: number) {
  if (!["笔试", "面试"].includes(app.status) || !items.length) return { label: displayStatus(app), summary: "", detail: displayStatus(app) };
  const scheduled = items.filter((session) => session.scheduled_at && sessionEndTimestamp(session) > 0);
  const active = scheduled.find((session) => +new Date(session.scheduled_at) <= now && sessionEndTimestamp(session) > now);
  const upcoming = scheduled.filter((session) => +new Date(session.scheduled_at) > now).sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at))[0];
  const ended = scheduled.filter((session) => sessionEndTimestamp(session) <= now).sort((a, b) => sessionEndTimestamp(a) - sessionEndTimestamp(b));
  const completed = ended.filter((session) => !["已取消", "已改期"].includes(sessionDisplayResult(session, now)));
  const current = active || upcoming || ended.at(-1);
  if (!current) return { label: displayStatus(app), summary: "", detail: displayStatus(app) };
  const round = current.round || current.type;
  let label = "";
  if (active) label = `${round}进行中`;
  else if (upcoming) label = `${round}待进行`;
  else {
    const result = sessionDisplayResult(current, now);
    const conciseResult: Record<string, string> = { "待进行": "待结果", "待定": "待结果", "已完成（待结果）": "待结果" };
    label = `${round}${conciseResult[result] || result}`;
  }
  const rounds = completed.map((session) => session.round || session.type);
  return {
    label,
    summary: completed.length ? `已完成 ${completed.length} 轮` : "",
    detail: completed.length ? `${label}；已完成：${rounds.join("、")}` : label,
  };
}

function DatePickerField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => parseDateOnly(value) || parseDateOnly(todayLocalDate()) || new Date());
  const selected = parseDateOnly(value);
  const today = parseDateOnly(todayLocalDate()) || new Date();
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [open]);
  function showCalendar() {
    setViewDate(selected || today);
    setOpen((current) => !current);
  }
  const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const firstCell = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1 - firstOfMonth.getDay());
  const days = Array.from({ length: 42 }, (_, index) => new Date(firstCell.getFullYear(), firstCell.getMonth(), firstCell.getDate() + index));
  return <div className="date-picker-field" ref={rootRef}>
    <button type="button" className={`date-picker-trigger ${value ? "" : "empty"}`} onClick={showCalendar} aria-haspopup="dialog" aria-expanded={open}>
      <span>{dateOnlyLabel(value)}</span><i>▣</i>
    </button>
    {open && <div className="date-picker-popover" role="dialog" aria-label="选择投递日期">
      <header>
        <b>{viewDate.getFullYear()}年{String(viewDate.getMonth() + 1).padStart(2, "0")}月</b>
        <div><button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} aria-label="上个月">‹</button><button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} aria-label="下个月">›</button></div>
      </header>
      <div className="date-picker-weekdays">{["日", "一", "二", "三", "四", "五", "六"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="date-picker-days">{days.map((day) => {
        const key = dateOnlyKey(day);
        const isCurrentMonth = day.getMonth() === viewDate.getMonth();
        const isSelected = key === value;
        const isToday = key === dateOnlyKey(today);
        return <button type="button" key={key} className={`date-picker-day ${isCurrentMonth ? "" : "outside"} ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}`} onClick={() => { onChange(key); setOpen(false); }} aria-label={key} aria-pressed={isSelected}>{day.getDate()}</button>;
      })}</div>
      <footer><button type="button" onClick={() => { onChange(""); setOpen(false); }}>清除</button><button type="button" onClick={() => { const key = dateOnlyKey(today); onChange(key); setViewDate(today); setOpen(false); }}>今天</button></footer>
    </div>}
  </div>;
}

export default function Home() {
  const [view, setView] = useState("overview");
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [applications, setApplications] = useState<Application[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [schedules, setSchedules] = useState<ScheduleEvent[]>([]);
  const [trash, setTrash] = useState<Application[]>([]);
  const [storage, setStorage] = useState({ root: "D:\\222", database: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [appEditor, setAppEditor] = useState<Application | null | "new">(null);
  const [sessionEditor, setSessionEditor] = useState<SessionDetail | null | "new">(null);
  const [scheduleEditor, setScheduleEditor] = useState<ScheduleEvent | null | "new">(null);
  const [prefillApp, setPrefillApp] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [checkingLinks, setCheckingLinks] = useState(false);
  const [linkCheckResults, setLinkCheckResults] = useState<LinkCheckResult[] | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  async function load() {
    try { const data = await request("/state"); setApplications(data.applications); setSessions(data.sessions); setResumes(data.resumes || []); setSchedules(data.schedules || []); setTrash(data.trash || []); setStorage(data.storage); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "无法连接数据服务"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const saved = window.localStorage.getItem("autumn-theme");
    const initial = saved === "dark" ? "dark" : "light";
    setTheme(initial); document.documentElement.dataset.theme = initial;
  }, []);
  useEffect(() => { setSidebarCollapsed(window.localStorage.getItem("autumn-sidebar-collapsed") === "true"); }, []);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next); document.documentElement.dataset.theme = next; window.localStorage.setItem("autumn-theme", next);
  }
  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next); window.localStorage.setItem("autumn-sidebar-collapsed", String(next));
  }
  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2600); }
  async function checkLinks() {
    if (checkingLinks) return;
    setCheckingLinks(true);
    try {
      const data = await request("/applications/check-links", { method: "POST", body: "{}" });
      setLinkCheckResults(data.results || []);
      await load();
      notify(data.checked ? `已检查 ${data.checked} 条链接` : "暂无可检查的链接");
    } catch (error) { notify(error instanceof Error ? error.message : "链接检查失败"); }
    finally { setCheckingLinks(false); }
  }
  async function trashCheckedLinks(ids: string[]) {
    if (!ids.length) return;
    if (!confirm(`确定将选中的 ${ids.length} 条投递移入回收站吗？30天内可以恢复。`)) return;
    try {
      const result = await request("/applications/trash", { method: "POST", body: JSON.stringify({ ids }) });
      setLinkCheckResults(null); await load(); notify(`已将 ${result.moved} 条投递移入回收站`);
    } catch (error) { notify(error instanceof Error ? error.message : "清理失败"); }
  }
  async function markCheckedLinkValid(id: string) {
    try {
      const result = await request(`/applications/${id}/link-check-valid`, { method: "POST", body: "{}" });
      setLinkCheckResults((current) => current?.map((item) => item.id === id ? { ...item, status: "valid", label: result.label, message: result.message } : item) || null);
      await load();
      notify("已标记为正常链接");
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "标记失败");
      return false;
    }
  }
  async function restoreApplication(app: Application) {
    try { await request(`/trash/${app.id}`, { method: "POST", body: "{}" }); await load(); notify("投递记录已恢复"); }
    catch (error) { notify(error instanceof Error ? error.message : "恢复失败"); }
  }
  async function permanentlyDeleteApplication(app: Application) {
    if (!confirm(`永久删除“${app.company} · ${app.role}”吗？招聘流程、复盘和附件将无法恢复。`)) return;
    try { await request(`/trash/${app.id}`, { method: "DELETE" }); await load(); notify("已永久删除"); }
    catch (error) { notify(error instanceof Error ? error.message : "永久删除失败"); }
  }
  async function emptyTrash() {
    if (!trash.length || !confirm(`清空回收站中的 ${trash.length} 条记录吗？此操作无法恢复。`)) return;
    try { await request("/trash", { method: "DELETE" }); await load(); notify("回收站已清空"); }
    catch (error) { notify(error instanceof Error ? error.message : "清空失败"); }
  }

  const upcoming = useMemo(() => [
    ...sessions.map((s) => ({ ...s, source: "session", agendaTitle: `${s.company} · ${s.round || s.type}` })),
    ...schedules.map((s) => ({ ...s, source: "schedule", agendaTitle: s.title })),
  ].filter((s) => s.scheduled_at && (s.source === "session" ? sessionEndTimestamp(s as Session) > clock : new Date(s.scheduled_at).getTime() >= clock - 3600000)).sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at)), [sessions, schedules, clock]);
  const filteredApps = useMemo(() => applications.filter((a) => (statusFilter === "全部" || a.status === statusFilter) && `${a.company}${a.role}${a.location || ""}`.toLowerCase().includes(search.toLowerCase())), [applications, search, statusFilter]);

  async function openSession(session: Session) {
    try { setSessionEditor(await request(`/sessions/${session.id}`)); } catch (e) { notify(e instanceof Error ? e.message : "读取失败"); }
  }
  function newSession(applicationId = "") { setPrefillApp(applicationId); setSessionEditor("new"); }
  async function updateStatus(app: Application, status: string, rejectionStage?: string) {
    const payload: Record<string, string> = { status };
    if (status === "已投递") payload.applied_at = todayLocalDate();
    if (status !== "拒绝" || rejectionStage !== undefined) payload.rejection_stage = status === "拒绝" ? rejectionStage || "" : "";
    await request(`/applications/${app.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    await load();
    notify(`已更新为“${status === "拒绝" && rejectionStage ? `拒绝 · ${rejectionStage}` : status}”${status === "已投递" ? "，投递日期已记为今天" : ""}`);
  }
  async function deleteApplication(app: Application) {
    if (!confirm(`确定将“${app.company} · ${app.role}”移入回收站吗？30天内可以恢复。`)) return;
    try { await request(`/applications/${app.id}`, { method: "DELETE" }); await load(); notify("已移入回收站"); }
    catch (error) { notify(error instanceof Error ? error.message : "删除失败"); }
  }
  async function deleteSessionFromList(session: Session) {
    if (!confirm(`确定删除“${session.company} · ${session.round || session.type}”吗？该流程下的题目和附件也会一起删除。`)) return;
    try { await request(`/sessions/${session.id}`, { method: "DELETE" }); await load(); notify("招聘流程已删除"); }
    catch (error) { notify(error instanceof Error ? error.message : "删除失败"); }
  }

  const viewTitle: Record<string, [string, string]> = {
    overview: [`${todayGreeting()}，今天继续向前。`, "把每一次投递和复盘，都变成下一次机会的底气。"],
    board: ["投递总览", "上百家企业，也能一眼看清每一份投递走到了哪里。"],
    applications: ["投递管理", "公司、岗位和进度都在这里。"], sessions: ["招聘流程", "按时间串起笔试与每一轮面试，结束后逐场复盘。"],
    calendar: ["近期日程", "别错过笔试、面试和结果通知。"], insights: ["数据复盘", "看清投递转化，也看见自己的进步。"], ai: ["AI 求职助手", "结合你的岗位、简历与复盘记录继续追问。"], resumes: ["我的简历库", "集中管理不同方向与版本的简历。"], trash: ["回收站", "删除的投递会保留30天，期间可以完整恢复。"], data: ["数据与备份", "所有核心数据仅保存在你的电脑。"],
  };

  return (
    <main className={`shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-head"><button className="brand" onClick={() => setView("overview")} title="返回总览"><span>秋</span><div><strong>秋招手账</strong><small>CAREER OS</small></div></button><button className="sidebar-toggle" onClick={toggleSidebar} aria-expanded={!sidebarCollapsed} aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}><i>{sidebarCollapsed ? "»" : "«"}</i><span>{sidebarCollapsed ? "展开" : "收起"}</span></button></div>
        <nav aria-label="主导航">{navItems.map(([id, icon, label]) => <button key={id} title={sidebarCollapsed ? label : undefined} className={view === id ? "active" : ""} onClick={() => setView(id)}><i>{icon}</i><span>{label}</span></button>)}</nav>
        <div className="storage-note"><small><i className={error ? "dot bad" : "dot"} />本地安全存储</small><b>{storage.root}</b><span>{error ? "数据服务未连接" : "记录已保存在你的电脑"}</span></div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div><p className="eyebrow">2026 AUTUMN RECRUITMENT</p><h1>{viewTitle[view][0]}</h1><p className="muted">{viewTitle[view][1]}</p><div className="hero-meta"><span><i />本地在线</span><span>{applications.length} 个求职目标</span><span>{resumes.length} 份简历</span></div></div>
          <div className="header-actions"><button className="theme-toggle" onClick={toggleTheme} aria-label={`切换到${theme === "dark" ? "浅色" : "深色"}模式`}><span className={theme === "light" ? "active" : ""}>☀</span><span className={theme === "dark" ? "active" : ""}>☾</span><b>{theme === "dark" ? "深色" : "浅色"}</b></button><button className="secondary compact" onClick={() => newSession()}>＋ 招聘流程</button><button className="primary" onClick={() => setAppEditor("new")}>＋ 新增投递</button></div>
        </header>

        {error && <div className="alert"><b>暂时无法读取本地数据</b><span>{error}。请关闭当前页面，然后从桌面重新打开“秋招手账”。</span><button onClick={load}>重新连接</button></div>}
        {loading ? <div className="loading">正在打开你的秋招手账…</div> : <>
          {view === "overview" && <Overview applications={applications} sessions={sessions} upcoming={upcoming} onAddApp={() => setAppEditor("new")} onAddSession={newSession} onAddSchedule={() => setScheduleEditor("new")} onOpenSession={openSession} onOpenSchedule={setScheduleEditor} onView={setView} />}
          {view === "board" && <ApplicationBoard applications={applications} sessions={sessions} clock={clock} onEdit={setAppEditor} onAdd={() => setAppEditor("new")} onCheckLinks={checkLinks} checkingLinks={checkingLinks} notify={notify} />}
          {view === "applications" && <ApplicationsView applications={filteredApps} sessions={sessions} clock={clock} search={search} setSearch={setSearch} filter={statusFilter} setFilter={setStatusFilter} onEdit={setAppEditor} onDelete={deleteApplication} onStatus={updateStatus} onSession={newSession} onOpenSession={openSession} onDeleteSession={deleteSessionFromList} onCheckLinks={checkLinks} checkingLinks={checkingLinks} />}
          {view === "sessions" && <SessionsView sessions={sessions} clock={clock} onOpen={openSession} onAdd={() => newSession()} />}
          {view === "calendar" && <CalendarView sessions={sessions} schedules={schedules} clock={clock} onOpenSession={openSession} onOpenSchedule={setScheduleEditor} onAdd={() => setScheduleEditor("new")} />}
          {view === "insights" && <InsightsView applications={applications} sessions={sessions} />}
          {view === "ai" && <AiChatView applications={applications} resumes={resumes} onOpenSettings={() => setView("data")} notify={notify} />}
          {view === "resumes" && <ResumeView resumes={resumes} onReload={load} notify={notify} />}
          {view === "trash" && <TrashView applications={trash} onRestore={restoreApplication} onDelete={permanentlyDeleteApplication} onEmpty={emptyTrash} />}
          {view === "data" && <DataView storage={storage} onNotify={notify} onReload={load} />}
        </>}
      </section>

      {appEditor && <ApplicationEditor value={appEditor === "new" ? null : appEditor} resumes={resumes} notify={notify} onClose={() => setAppEditor(null)} onSaved={async () => { setAppEditor(null); await load(); notify("投递记录已保存"); }} onDeleted={async () => { setAppEditor(null); await load(); notify("已移入回收站"); }} />}
      {sessionEditor && <SessionEditor value={sessionEditor === "new" ? null : sessionEditor} applications={applications} sessions={sessions} initialApplication={prefillApp} onClose={() => setSessionEditor(null)} onSaved={async () => { setSessionEditor(null); await load(); notify("招聘流程已保存"); }} onRefresh={async (id) => setSessionEditor(await request(`/sessions/${id}`))} notify={notify} />}
      {scheduleEditor && <ScheduleEditor value={scheduleEditor === "new" ? null : scheduleEditor} applications={applications} onClose={() => setScheduleEditor(null)} onSaved={async () => { setScheduleEditor(null); await load(); notify("日程已保存"); }} />}
      {linkCheckResults && <LinkCheckModal results={linkCheckResults} onClose={() => setLinkCheckResults(null)} onTrash={trashCheckedLinks} onMarkValid={markCheckedLinkValid} />}
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}

function Overview({ applications, sessions, upcoming, onAddApp, onAddSession, onAddSchedule, onOpenSession, onOpenSchedule, onView }: any) {
  const examSessions = sessions.filter((s: Session) => ["笔试", "测评"].includes(s.type));
  const interviewSessions = sessions.filter((s: Session) => ["面试", "AI面试"].includes(s.type));
  const submittedCount = applications.filter((a: Application) => ["已投递", "笔试", "面试", "OC", "Offer", "拒绝"].includes(a.status)).length;
  const examCount = examSessions.length + applications.filter((a: Application) => a.status === "笔试" && !examSessions.some((s: Session) => s.application_id === a.id)).length;
  const interviewCount = interviewSessions.length + applications.filter((a: Application) => a.status === "面试" && !interviewSessions.some((s: Session) => s.application_id === a.id)).length;
  const cards = [
    { label: "准备投递", count: applications.filter((a: Application) => a.status === "准备投递").length, caption: "当前待投岗位", target: "applications" },
    { label: "已投递", count: submittedCount, caption: "累计投递岗位", target: "applications" },
    { label: "笔试 / 测评", count: examCount, caption: `累计场次 · 当前 ${applications.filter((a: Application) => a.status === "笔试").length} 个岗位`, target: "sessions" },
    { label: "面试 / AI面试", count: interviewCount, caption: `累计场次 · 当前 ${applications.filter((a: Application) => a.status === "面试").length} 个岗位`, target: "sessions" },
    { label: "Offer", count: applications.filter((a: Application) => a.status === "Offer").length, caption: "当前获得 Offer", target: "applications" },
  ];
  const recent = applications.slice(0, 5);
  return <>
    <section className="stage-grid">{cards.map((item, i) => <button className={`stat tone-${i}`} key={item.label} onClick={() => onView(item.target)}><p>{item.label}</p><strong>{item.count}</strong><span>{item.caption} →</span></button>)}</section>
    <section className="dashboard-grid">
      <article className="panel applications"><div className="panel-title"><div><p className="eyebrow">正在进行</p><h2>最近投递</h2></div><button className="text-button" onClick={() => onView("applications")}>查看全部 →</button></div>
        {recent.length ? <div className="application-list">{recent.map((a: Application) => <div className="application" key={a.id}><div className="company-mark">{a.company[0]}</div><div className="grow"><b>{a.company}</b><span>{a.role}{a.location ? ` · ${a.location}` : ""}</span></div><span className={`status-chip s-${statuses.indexOf(a.status)}`}>{displayStatus(a)}</span><button className="mini-action" onClick={() => onAddSession(a.id)}>记一场</button></div>)}</div> : <Empty title="还没有投递记录" text="从第一家公司开始，建立你的秋招进度。" action="新增第一条投递" onClick={onAddApp} />}
      </article>
      <article className="panel next-up"><p className="eyebrow">接下来</p><h2>近期日程</h2>{upcoming.length ? <div className="timeline">{upcoming.slice(0, 3).map((s: any) => <button key={`${s.source}-${s.id}`} onClick={() => s.source === "session" ? onOpenSession(s) : onOpenSchedule(s)}><time>{new Date(s.scheduled_at).getDate()}<small>{new Date(s.scheduled_at).getMonth() + 1}月</small></time><p><b>{s.agendaTitle}</b><span>{formatDate(s.scheduled_at)} · {s.source === "session" ? s.type : s.event_type}</span></p></button>)}</div> : <Empty compact title="最近没有安排" text="添加截止日期、宣讲会、提醒或招聘流程安排。" action="添加日程" onClick={onAddSchedule} />}</article>
      <article className="panel reflection"><p className="eyebrow">累计沉淀</p><h2>{sessions.reduce((n: number, s: Session) => n + Number(s.question_count || 0), 0)} 道题目被记录</h2><p>逐题写下你的回答和参考答案，勾选待复习项，让每一次经历都有价值。</p><button className="secondary" onClick={() => onView("sessions")}>查看全部复盘</button></article>
    </section>
  </>;
}

function ApplicationBoard({ applications, sessions, clock, onEdit, onAdd, onCheckLinks, checkingLinks, notify }: { applications: Application[]; sessions: Session[]; clock: number; onEdit: (app: Application) => void; onAdd: () => void; onCheckLinks: () => void; checkingLinks: boolean; notify: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部");
  const [priorityFilter, setPriorityFilter] = useState("全部优先级");
  const [sortBy, setSortBy] = useState("当前进度");
  const [compact, setCompact] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const counts = useMemo(() => Object.fromEntries(statuses.map((status) => [status, applications.filter((app) => app.status === status).length])), [applications]);
  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const next = applications.filter((app) => (filter === "全部" || app.status === filter) && (priorityFilter === "全部优先级" || app.priority === priorityFilter) && (!keyword || `${app.company}${app.role}${app.location || ""}${app.channel || ""}`.toLowerCase().includes(keyword)));
    return [...next].sort((a, b) => {
      if (sortBy === "公司名称") return a.company.localeCompare(b.company, "zh-CN");
      if (sortBy === "当前进度") return (progressRanks[a.status] ?? 99) - (progressRanks[b.status] ?? 99) || +new Date(String(b.updated_at || 0)) - +new Date(String(a.updated_at || 0));
      if (sortBy === "优先级：高到低") return (priorityRanks[a.priority] ?? 1) - (priorityRanks[b.priority] ?? 1) || +new Date(String(b.updated_at || 0)) - +new Date(String(a.updated_at || 0));
      if (sortBy === "优先级：低到高") return (priorityRanks[b.priority] ?? 1) - (priorityRanks[a.priority] ?? 1) || +new Date(String(b.updated_at || 0)) - +new Date(String(a.updated_at || 0));
      return +new Date(String(b.updated_at || 0)) - +new Date(String(a.updated_at || 0));
    });
  }, [applications, filter, priorityFilter, query, sortBy]);

  async function exportExcel() {
    if (!visible.length || exportingExcel) return;
    setExportingExcel(true);
    try {
      const response = await fetch(`${API}/applications/export.xlsx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: visible.map((application) => application.id) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "导出失败");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `秋招投递总览-${todayLocalDate()}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(`已导出 ${visible.length} 条投递记录`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExportingExcel(false);
    }
  }

  return <section className="application-board">
    <div className="board-overview">
      <div className="board-total"><span>全部企业</span><strong>{applications.length}</strong><small>份投递记录</small></div>
      <div className="board-legend" aria-label="按投递状态筛选">
        <button className={filter === "全部" ? "active" : ""} onClick={() => setFilter("全部")} aria-pressed={filter === "全部"}><i className="legend-all" />全部<b>{applications.length}</b></button>
        {statuses.map((status, index) => <button key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(status)} aria-pressed={filter === status}><i className={`legend-status-${index}`} />{status}<b>{counts[status]}</b></button>)}
      </div>
    </div>
    <div className="board-toolbar">
      <label className="board-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公司、岗位、城市或渠道" /></label>
      <label className="board-priority"><span>优先级</span><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option>全部优先级</option><option>高</option><option>中</option><option>低</option></select></label>
      <label className="board-sort"><span>排序</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option>最近更新</option><option>公司名称</option><option>当前进度</option><option>优先级：高到低</option><option>优先级：低到高</option></select></label>
      <button className={`board-density ${compact ? "active" : ""}`} onClick={() => setCompact(!compact)} aria-pressed={compact}><i>▦</i>{compact ? "紧凑" : "舒展"}</button>
      <button className="link-check-button" onClick={onCheckLinks} disabled={checkingLinks}>⌁ {checkingLinks ? "检查中…" : "一键检查链接"}</button>
      <button className="link-check-button excel-export-button" onClick={exportExcel} disabled={!visible.length || exportingExcel}>⇩ {exportingExcel ? "导出中…" : "导出 Excel"}</button>
      <span className="board-result">显示 <b>{visible.length}</b> / {applications.length}</span>
    </div>
    {visible.length ? <div className={`company-matrix ${compact ? "compact" : "comfortable"}`}>
      {visible.map((app) => { const statusIndex = Math.max(0, statuses.indexOf(app.status)); const stage = applicationStage(app, sessions.filter((session) => session.application_id === app.id), clock); return <button key={app.id} className={`company-tile board-status-${statusIndex}`} onClick={() => onEdit(app)} title={`${app.company} · ${app.role} · ${stage.detail}`}>
        <span className="company-tile-head"><b>{app.company}</b><i>{stage.label}</i></span>
        <small>{app.role || "岗位未填写"}</small>
        {!compact && stage.summary && <span className="company-tile-progress">{stage.summary}</span>}
        {!compact && <span className="company-tile-meta"><em>{app.location || "地点未填"}</em><em>{app.channel || "渠道未填"}</em></span>}
      </button>; })}
    </div> : <div className="board-empty"><Empty title={applications.length ? "没有符合条件的企业" : "还没有投递记录"} text={applications.length ? "换个状态或搜索关键词试试。" : "添加第一家公司后，这里会自动生成彩色投递矩阵。"} action={applications.length ? undefined : "新增第一条投递"} onClick={onAdd} /></div>}
  </section>;
}

function ApplicationsView({ applications, sessions, clock, search, setSearch, filter, setFilter, onEdit, onDelete, onStatus, onSession, onOpenSession, onDeleteSession, onCheckLinks, checkingLinks }: any) {
  const [expanded, setExpanded] = useState("");
  const [showSalary, setShowSalary] = useState(false);
  const [sortBy, setSortBy] = useState("当前进度");
  useEffect(() => { setShowSalary(window.localStorage.getItem("autumn-show-salary") === "true"); }, []);
  function toggleSalary() { const next = !showSalary; setShowSalary(next); window.localStorage.setItem("autumn-show-salary", String(next)); }
  function appSessions(id: string) { return sessions.filter((s: Session) => s.application_id === id).sort((a: Session, b: Session) => +new Date(a.scheduled_at || 0) - +new Date(b.scheduled_at || 0)); }
  function nextSession(items: Session[]) { return items.filter((s) => s.scheduled_at && sessionEndTimestamp(s) > clock).sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at))[0]; }
  const sortedApplications = useMemo(() => {
    const timestamp = (value: unknown) => {
      const parsed = +new Date(String(value || ""));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const recentlyUpdated = (a: Application, b: Application) => timestamp(b.updated_at) - timestamp(a.updated_at);
    return [...applications].sort((a: Application, b: Application) => {
      if (sortBy === "优先级：高到低") return (priorityRanks[a.priority] ?? 1) - (priorityRanks[b.priority] ?? 1) || recentlyUpdated(a, b);
      if (sortBy === "优先级：低到高") return (priorityRanks[b.priority] ?? 1) - (priorityRanks[a.priority] ?? 1) || recentlyUpdated(a, b);
      if (sortBy === "当前进度") return (progressRanks[a.status] ?? 99) - (progressRanks[b.status] ?? 99) || recentlyUpdated(a, b);
      if (sortBy === "投递日期：最新") {
        const aTime = timestamp(a.applied_at); const bTime = timestamp(b.applied_at);
        if (!aTime || !bTime) return aTime ? -1 : bTime ? 1 : recentlyUpdated(a, b);
        return bTime - aTime || recentlyUpdated(a, b);
      }
      if (sortBy === "投递日期：最早") {
        const aTime = timestamp(a.applied_at); const bTime = timestamp(b.applied_at);
        if (!aTime || !bTime) return aTime ? -1 : bTime ? 1 : recentlyUpdated(a, b);
        return aTime - bTime || recentlyUpdated(a, b);
      }
      if (sortBy === "公司名称") return a.company.localeCompare(b.company, "zh-CN") || a.role.localeCompare(b.role, "zh-CN");
      return recentlyUpdated(a, b);
    });
  }, [applications, sortBy]);
  return <section className="workspace-panel">
    <div className="toolbar">
      <label className="search">⌕<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索公司、岗位或城市" /></label>
      <select value={filter} onChange={(e) => setFilter(e.target.value)}><option>全部</option>{statuses.map((s) => <option key={s}>{s}</option>)}</select>
      <label className="management-sort"><span>排序</span><select value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option>最近更新</option><option>当前进度</option><option>优先级：高到低</option><option>优先级：低到高</option><option>投递日期：最新</option><option>投递日期：最早</option><option>公司名称</option></select></label>
      <button className={`salary-toggle ${showSalary ? "active" : ""}`} onClick={toggleSalary} aria-pressed={showSalary} aria-label={showSalary ? "隐藏薪资" : "显示薪资"}><i>￥</i>{showSalary ? "隐藏薪资" : "显示薪资"}</button>
      <button className="link-check-button" onClick={onCheckLinks} disabled={checkingLinks}>⌁ {checkingLinks ? "检查中…" : "一键检查链接"}</button>
      <span>{applications.length} 条记录</span>
    </div>
    {applications.length ? <div className="table-wrap"><table className={`process-table ${showSalary ? "show-salary" : ""}`}><thead><tr><th>公司 / 岗位</th><th>当前进度</th><th>下一安排</th><th>当前状态</th><th>优先级</th>{showSalary && <th className="salary-column">薪资</th>}<th className="actions-column">操作</th></tr></thead><tbody>
      {sortedApplications.map((a: Application) => {
        const items = appSessions(a.id); const next = nextSession(items); const isOpen = expanded === a.id; const hasSubmitted = a.status !== "准备投递"; const directUrl = externalUrl(a.apply_url);
        return <Fragment key={a.id}>
          <tr>
            <td><div className="company-cell"><i>{a.company[0]}</i><span><b>{a.company}</b><small>{a.role}{a.location ? ` · ${a.location}` : ""}</small></span><button className="flow-toggle" onClick={() => setExpanded(isOpen ? "" : a.id)}>{isOpen ? "收起流程" : `查看流程${items.length ? ` (${items.length})` : ""}`}<em>{isOpen ? "⌃" : "⌄"}</em></button></div></td>
            <td><span className="stage-pill">{applicationStage(a, items, clock).label}</span></td>
            <td>{next ? <button className="next-process" onClick={() => onOpenSession(next)}><b>{next.round || next.type}</b><small>{formatDate(next.scheduled_at)}</small></button> : <span className="no-plan">暂无安排</span>}</td>
            <td><div className="status-control"><select className="status-select" value={a.status} onChange={(e) => onStatus(a, e.target.value)}>{statuses.map((s) => <option key={s}>{s}</option>)}</select>{a.status === "拒绝" && <select className="status-select rejection-stage-select" aria-label="拒绝阶段" value={a.rejection_stage || ""} onChange={(e) => onStatus(a, "拒绝", e.target.value)}><option value="">选择拒绝阶段</option>{rejectionStages.map((stage) => <option key={stage}>{stage}</option>)}</select>}</div></td>
            <td><span className={`priority p-${a.priority}`}>{a.priority}</span></td>
            {showSalary && <td className="salary-column"><span className={a.salary ? "salary-value" : "salary-empty"}>{a.salary || "未填写"}</span></td>}
            <td className="actions-column"><div className="row-actions">{directUrl && <a className="link-action" href={directUrl} target="_blank" rel="noopener noreferrer" aria-label={`打开 ${a.company} 的网申或 JD 链接`}>↗ 直达</a>}<button className="session-action" onClick={() => onSession(a.id)}>＋ 招聘流程</button><button className="edit-action" onClick={() => onEdit(a)}>✎ 编辑</button><button className="delete-action" onClick={() => onDelete(a)}>× 删除</button></div></td>
          </tr>
          {isOpen && <tr className="process-detail-row"><td colSpan={showSalary ? 7 : 6}><div className="process-track">
            <div className="process-node process-base"><span className={`process-kind ${hasSubmitted ? "complete" : "pending"}`}>{hasSubmitted ? "完成" : "待投"}</span><span><b>{hasSubmitted ? "已投递" : "准备投递"}</b><small>{a.applied_at ? `${hasSubmitted ? "投递" : "计划"} ${a.applied_at}` : "日期未填"}</small></span></div>
            {items.map((s: Session) => { const active = Boolean(s.scheduled_at && sessionEndTimestamp(s) > clock); const displayResult = s.result === "待进行" && +new Date(s.scheduled_at) <= clock && active ? "进行中" : sessionDisplayResult(s, clock); return <div className={`process-item ${active ? "upcoming" : "done"}`} key={s.id}><button className="process-node-main" onClick={() => onOpenSession(s)}><span className={`process-kind ${sessionTypeClass(s.type)}`}>{s.type}</span><span><b>{s.round || s.type}</b><small>{formatDate(s.scheduled_at)} · {displayResult}</small></span></button><div className="process-node-actions"><button onClick={() => onOpenSession(s)}>编辑</button><button className="remove" onClick={() => onDeleteSession(s)}>删除</button></div></div>; })}
            <button className="process-add" onClick={() => onSession(a.id)}>＋ 添加下一轮</button>
          </div></td></tr>}
        </Fragment>;
      })}
    </tbody></table></div> : <Empty title="没有符合条件的投递" text="换个筛选条件，或新增一条投递记录。" />}
  </section>;
}

function LinkCheckModal({ results, onClose, onTrash, onMarkValid }: { results: LinkCheckResult[]; onClose: () => void; onTrash: (ids: string[]) => void; onMarkValid: (id: string) => Promise<boolean> }) {
  const [selected, setSelected] = useState(() => results.filter((item) => item.status === "invalid" || item.status === "closed").map((item) => item.id));
  const [marking, setMarking] = useState("");
  const summary = {
    valid: results.filter((item) => item.status === "valid").length,
    invalid: results.filter((item) => item.status === "invalid").length,
    closed: results.filter((item) => item.status === "closed").length,
    review: results.filter((item) => item.status === "review").length,
  };
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  async function markValid(id: string) {
    setMarking(id);
    const saved = await onMarkValid(id);
    if (saved) setSelected((current) => current.filter((item) => item !== id));
    setMarking("");
  }
  return <Modal wide title="链接检查结果" subtitle="先快速检查，受限网站会自动使用真实浏览器复查；只有明确失效或关闭的记录可以一键清理。" onClose={onClose}>
    <div className="link-check-content">
      <div className="link-check-summary">
        <span className="check-valid">正常 <b>{summary.valid}</b></span>
        <span className="check-invalid">失效 <b>{summary.invalid}</b></span>
        <span className="check-closed">已关闭 <b>{summary.closed}</b></span>
        <span className="check-review">需复核 <b>{summary.review}</b></span>
      </div>
      {results.length ? <div className="link-check-list">{results.map((item) => {
        const canSelect = item.status === "invalid" || item.status === "closed";
        return <div className={`link-check-row check-${item.status}`} key={item.id}>
          <input type="checkbox" aria-label={`选择 ${item.company} ${item.role}`} checked={selected.includes(item.id)} disabled={!canSelect} onChange={() => toggle(item.id)} />
          <div><strong>{item.company}</strong><span>{item.role}</span><small>{item.message}</small></div>
          <em>{item.label}</em>
          <div className="link-check-row-actions">
            {externalUrl(item.url) && <a href={externalUrl(item.url)} target="_blank" rel="noopener noreferrer">打开链接 ↗</a>}
            {item.status === "review" && <button type="button" disabled={marking === item.id} onClick={() => markValid(item.id)}>{marking === item.id ? "保存中…" : "标记正常"}</button>}
          </div>
        </div>;
      })}</div> : <Empty title="暂无可检查的链接" text="填写网申或 JD 链接后，就可以在这里批量检查。" />}
      <div className="link-check-actions"><span>已选择 {selected.length} 条，清理后将在回收站保留30天。</span><button className="secondary compact" onClick={onClose}>关闭</button><button className="trash-selected" disabled={!selected.length} onClick={() => onTrash(selected)}>移入回收站（{selected.length}）</button></div>
    </div>
  </Modal>;
}

function TrashView({ applications, onRestore, onDelete, onEmpty }: { applications: Application[]; onRestore: (app: Application) => void; onDelete: (app: Application) => void; onEmpty: () => void }) {
  function daysLeft(value: unknown) {
    const deletedAt = new Date(String(value || "")).getTime();
    if (!Number.isFinite(deletedAt)) return 30;
    return Math.max(0, Math.ceil((deletedAt + 30 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000)));
  }
  return <section className="trash-panel">
    <div className="trash-toolbar"><div><b>{applications.length} 条已删除投递</b><span>到期后将自动永久删除</span></div>{Boolean(applications.length) && <button className="empty-trash-action" onClick={onEmpty}>清空回收站</button>}</div>
    {applications.length ? <div className="trash-list">{applications.map((app) => <article className="trash-card" key={app.id}>
      <div className="trash-mark">{app.company[0]}</div>
      <div className="trash-main"><h3>{app.company}</h3><p>{app.role}{app.location ? ` · ${app.location}` : ""}</p><span>删除于 {formatDate(String(app.deleted_at))} · 剩余 {daysLeft(app.deleted_at)} 天</span>{Number(app.session_count || 0) > 0 && <small>包含 {app.session_count} 条招聘流程记录</small>}</div>
      {externalUrl(app.apply_url) && <a href={externalUrl(app.apply_url)} target="_blank" rel="noopener noreferrer">原链接 ↗</a>}
      <div className="trash-actions"><button onClick={() => onRestore(app)}>恢复</button><button className="permanent-delete" onClick={() => onDelete(app)}>永久删除</button></div>
    </article>)}</div> : <Empty title="回收站是空的" text="删除的投递会在这里保留30天，期间可以完整恢复。" />}
  </section>;
}

function SessionsView({ sessions, clock, onOpen, onAdd }: any) {
  return <section className="session-grid">{sessions.length ? sessions.map((s: Session) => {
    const displayResult = s.result === "待进行" && +new Date(s.scheduled_at) <= clock && sessionEndTimestamp(s) > clock ? "进行中" : sessionDisplayResult(s, clock);
    return <button className="session-card" key={s.id} onClick={() => onOpen(s)}><div className="session-card-top"><span className={`kind ${sessionTypeClass(s.type)}`}>{s.type}</span><span className={`result r-${displayResult}`}>{displayResult}</span></div><h3>{s.company} · {s.round || s.type}</h3><p>{s.role}</p><dl><div><dt>时间</dt><dd>{formatDate(s.scheduled_at)}</dd></div><div><dt>题目</dt><dd>{s.question_count || 0} 道</dd></div><div><dt>评分</dt><dd>{Number(s.rating) ? `${s.rating}/5` : "未评分"}</dd></div></dl><span className="open-note">打开详细复盘 →</span></button>;
  }) : <div className="full-empty"><Empty title="还没有招聘流程记录" text="笔试、面试、AI面试和测评都可以单独记录与复盘。" action="记录第一次招聘流程" onClick={onAdd} /></div>}</section>;
}

function CalendarView({ sessions, schedules, clock, onOpenSession, onOpenSchedule, onAdd }: any) {
  const sorted = [
    ...sessions.filter((s: Session) => s.scheduled_at).map((s: Session) => ({ ...s, source: "session", agendaTitle: `${s.company} · ${s.round || s.type}`, agendaDetail: `${s.format || "形式待定"}${s.duration ? ` · ${s.duration} 分钟` : ""}`, agendaKind: s.type })),
    ...schedules.map((s: ScheduleEvent) => ({ ...s, source: "schedule", agendaTitle: s.title, agendaDetail: [s.company, s.location, s.reminder].filter(Boolean).join(" · "), agendaKind: s.event_type })),
  ].sort((a, b) => {
    const aCompleted = a.source === "session" ? sessionEndTimestamp(a as Session) <= clock : Boolean(a.completed) || +new Date(a.scheduled_at) < clock;
    const bCompleted = b.source === "session" ? sessionEndTimestamp(b as Session) <= clock : Boolean(b.completed) || +new Date(b.scheduled_at) < clock;
    if (aCompleted !== bCompleted) return Number(aCompleted) - Number(bCompleted);
    return +new Date(b.scheduled_at) - +new Date(a.scheduled_at);
  });
  return <section className="calendar-panel"><div className="calendar-toolbar"><div><p className="eyebrow">AGENDA</p><b>{sorted.length} 项安排</b></div><button className="primary compact" onClick={onAdd}>＋ 添加日程</button></div>{sorted.length ? sorted.map((s: any) => { const d = new Date(s.scheduled_at); const past = s.source === "session" ? sessionEndTimestamp(s as Session) <= clock : d.getTime() < clock; return <button className={`calendar-row ${past || s.completed ? "past" : ""}`} key={`${s.source}-${s.id}`} onClick={() => s.source === "session" ? onOpenSession(s) : onOpenSchedule(s)}><time><b>{d.getDate()}</b><span>{d.getMonth() + 1}月</span></time><i /><div><small>{s.completed ? "已完成" : past ? (s.source === "session" ? sessionDisplayResult(s as Session, clock) : "已过期") : d.getTime() <= clock ? "进行中" : "即将进行"}</small><h3>{s.agendaTitle}</h3><p>{formatDate(s.scheduled_at)}{s.agendaDetail ? ` · ${s.agendaDetail}` : ""}</p></div><span className={`kind ${s.agendaKind === "笔试" || s.agendaKind === "投递截止" ? "exam" : ""}`}>{s.agendaKind}</span></button>; }) : <Empty title="日程还是空的" text="可以添加投递截止、宣讲会、结果提醒或其他安排。" action="添加第一条日程" onClick={onAdd} />}</section>;
}

function InsightsView({ applications, sessions }: any) {
  const total = applications.length || 1; const funnel = ["已投递", "笔试", "面试", "OC", "Offer"].map((label) => ({ label, count: applications.filter((a: Application) => statuses.indexOf(a.status) >= statuses.indexOf(label) && !["拒绝", "放弃"].includes(a.status)).length }));
  const channels = Object.entries(applications.reduce((acc: Record<string, number>, a: Application) => { const key = String(a.channel || "未填写"); acc[key] = (acc[key] || 0) + 1; return acc; }, {})).sort((a: any, b: any) => b[1] - a[1]);
  return <section className="insights-grid"><article className="panel funnel"><p className="eyebrow">转化漏斗</p><h2>从投递到 Offer</h2>{funnel.map((x) => <div key={x.label}><span>{x.label}<b>{x.count}</b></span><i style={{ width: `${Math.max(4, applications.length ? x.count / total * 100 : 0)}%` }} /></div>)}</article><article className="panel"><p className="eyebrow">记录质量</p><h2>你的复盘积累</h2><div className="big-number">{sessions.length}<small>场招聘流程</small></div><div className="insight-line"><span>累计题目</span><b>{sessions.reduce((n: number, s: Session) => n + Number(s.question_count || 0), 0)} 道</b></div><div className="insight-line"><span>已有结果</span><b>{sessions.filter((s: Session) => s.result !== "待定").length} 场</b></div></article><article className="panel channels"><p className="eyebrow">渠道分布</p><h2>投递来自哪里</h2>{channels.length ? channels.map(([name, count]: any) => <div key={name}><span>{name}</span><b>{count}</b><i style={{ width: `${count / total * 100}%` }} /></div>) : <p className="muted">填写投递渠道后，这里会自动统计。</p>}</article></section>;
}

function ResumeView({ resumes, onReload, notify }: { resumes: Resume[]; onReload: () => Promise<void>; notify: (message: string) => void }) {
  const [showUpload, setShowUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ title: "", version: "", target_role: "", notes: "" });
  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return notify("请选择一份简历文件");
    if (file.size > 20 * 1024 * 1024) return notify("单份简历不能超过 20MB");
    setBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await request("/resumes", { method: "POST", body: JSON.stringify({ ...form, name: file.name, type: file.type, data: String(reader.result).split(",")[1] }) });
        setForm({ title: "", version: "", target_role: "", notes: "" }); setFile(null); setShowUpload(false); await onReload(); notify("简历已保存到本机");
      } catch (e) { notify(e instanceof Error ? e.message : "上传失败"); }
      finally { setBusy(false); }
    };
    reader.readAsDataURL(file);
  }
  async function remove(id: string) {
    if (!confirm("确定删除这份简历吗？本机文件也会一并删除。")) return;
    await request(`/resumes/${id}`, { method: "DELETE" }); await onReload(); notify("简历已删除");
  }
  async function setDefault(id: string) {
    await request(`/resumes/${id}/default`, { method: "POST" });
    await onReload();
    notify("默认简历已更新");
  }
  return <section className="resume-workspace">
    <article className="resume-hero"><div><p className="eyebrow">RESUME VAULT</p><h2>你的简历版本中心</h2><p>针对后端、算法、产品等方向保留不同版本，投递时不再找错文件。</p></div><button className="primary" onClick={() => setShowUpload(!showUpload)}>{showUpload ? "收起上传" : "＋ 上传简历"}</button></article>
    {showUpload && <form className="resume-upload" onSubmit={upload}><div className="upload-drop"><span>⇧</span><b>{file ? file.name : "选择 PDF、Word 简历"}</b><small>文件保存在 D:\\222\\resumes，最大 20MB</small><label className="secondary compact file-label">选择文件<input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label></div><div className="resume-fields"><label>简历名称 *<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：后端开发简历" /></label><label>版本<input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="例如：2026秋招-v3" /></label><label>目标方向<input value={form.target_role} onChange={(e) => setForm({ ...form, target_role: e.target.value })} placeholder="Java后端 / 算法 / 产品" /></label><label>备注<textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="这版简历突出哪些经历…" /></label><button className="primary" disabled={busy}>{busy ? "正在保存…" : "保存到简历库"}</button></div></form>}
    <div className="resume-grid">{resumes.length ? resumes.map((r) => <article className={`resume-card ${r.is_default ? "is-default" : ""}`} key={r.id}><div className="file-mark">{r.original_name.toLowerCase().endsWith(".pdf") ? "PDF" : "DOC"}</div><div className="resume-card-head"><span className={r.is_default ? "resume-default-badge" : ""}>{r.is_default ? "默认简历" : (r.version || "未标版本")}</span><button onClick={() => remove(r.id)}>×</button></div><h3>{r.title}</h3><p>{r.target_role || "通用方向"}</p><small>{r.notes || r.original_name}</small><time className="resume-uploaded" dateTime={r.created_at}>上传于 {formatDate(r.created_at)}</time><footer><span>{Math.max(1, Math.ceil(r.size / 1024))} KB</span><div className="resume-footer-actions">{!r.is_default && <button type="button" onClick={() => setDefault(r.id)}>设为默认</button>}<a href={`${API}/resumes/${r.id}`} target="_blank" rel="noreferrer">打开简历 ↗</a></div></footer></article>) : <div className="resume-empty"><span>◈</span><h3>简历库还是空的</h3><p>上传你的第一份简历，让投递资料和秋招进度待在一起。</p><button className="secondary compact" onClick={() => setShowUpload(true)}>上传第一份简历</button></div>}</div>
  </section>;
}

function AiChatView({ applications, resumes, onOpenSettings, notify }: { applications: Application[]; resumes: Resume[]; onOpenSettings: () => void; notify: (message: string) => void }) {
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [applicationId, setApplicationId] = useState("");
  const [resumeId, setResumeId] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState("");
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const quickPrompts = [
    ["岗位匹配", "请结合关联岗位和简历，分析我的匹配优势、明确缺口，并给出最优先的三个准备动作。"],
    ["模拟面试", "请基于关联岗位和我的简历模拟一轮面试。先问我一道最可能出现的问题，等我回答后再点评和追问。"],
    ["面试复盘", "请总结已记录的招聘流程和题目，找出反复出现的薄弱点，并给出一周复习安排。"],
    ["今日计划", "请结合当前岗位进度、简历和面试记录，给我一份今天可以完成的求职准备清单，按优先级排序。"],
  ];
  useEffect(() => {
    Promise.all([request("/ai/conversations"), request("/ai/config")]).then(([history, config]) => {
      const items = history.conversations || [];
      setConversations(items);
      setAiConfig(config);
      if (items[0]) selectConversation(items[0].id);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "AI 助手加载失败"));
  }, []);
  useEffect(() => { setHistoryCollapsed(window.localStorage.getItem("autumn-ai-history-collapsed") === "true"); }, []);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const list = messageListRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, busy]);
  async function refreshConversations() {
    const data = await request("/ai/conversations");
    setConversations(data.conversations || []);
    return data.conversations || [];
  }
  async function selectConversation(id: string) {
    setActiveId(id);
    setLoadingMessages(true);
    setError("");
    try {
      const data = await request(`/ai/conversations/${id}/messages`);
      setMessages(data.messages || []);
      setApplicationId(data.conversation.application_id || "");
      setResumeId(data.conversation.resume_id || "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "对话读取失败"); }
    finally { setLoadingMessages(false); }
  }
  function newConversation() {
    setActiveId("");
    setMessages([]);
    setApplicationId("");
    setResumeId("");
    setDraft("");
    setError("");
  }
  function toggleHistory() {
    const next = !historyCollapsed;
    setHistoryCollapsed(next);
    window.localStorage.setItem("autumn-ai-history-collapsed", String(next));
  }
  async function updateContext(key: "application_id" | "resume_id", value: string) {
    if (key === "application_id") setApplicationId(value); else setResumeId(value);
    if (!activeId) return;
    try {
      await request(`/ai/conversations/${activeId}`, { method: "PATCH", body: JSON.stringify({ [key]: value }) });
      await refreshConversations();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "上下文更新失败"); }
  }
  async function renameConversation(conversation: AiConversation) {
    const title = prompt("对话名称", conversation.title)?.trim();
    if (!title || title === conversation.title) return;
    try { await request(`/ai/conversations/${conversation.id}`, { method: "PATCH", body: JSON.stringify({ title }) }); await refreshConversations(); }
    catch (reason) { notify(reason instanceof Error ? reason.message : "重命名失败"); }
  }
  async function deleteConversation(conversation: AiConversation) {
    if (!confirm(`删除对话“${conversation.title}”吗？此操作无法恢复。`)) return;
    try {
      await request(`/ai/conversations/${conversation.id}`, { method: "DELETE" });
      const next = await refreshConversations();
      if (activeId === conversation.id) {
        if (next[0]) await selectConversation(next[0].id); else newConversation();
      }
      notify("AI 对话已删除");
    } catch (reason) { notify(reason instanceof Error ? reason.message : "删除失败"); }
  }
  async function sendMessage(content = draft) {
    const message = content.trim();
    if (!message || busy) return;
    if (!aiConfig?.configured) { setError("请先在“数据与备份”中配置并测试 AI 模型"); return; }
    const temporaryId = `pending-${Date.now()}`;
    const previousDraft = draft;
    setDraft("");
    setError("");
    setBusy(true);
    setMessages((current) => [...current, { id: temporaryId, conversation_id: activeId, role: "user", content: message, sources: [], created_at: new Date().toISOString() }]);
    try {
      const result = await request("/ai/chat", { method: "POST", body: JSON.stringify({ conversation_id: activeId, application_id: applicationId, resume_id: resumeId, message }) });
      setActiveId(result.conversation.id);
      const fresh = await request(`/ai/conversations/${result.conversation.id}/messages`);
      setMessages(fresh.messages || []);
      setApplicationId(fresh.conversation.application_id || "");
      setResumeId(fresh.conversation.resume_id || "");
      await refreshConversations();
    } catch (reason) {
      setMessages((current) => current.filter((item) => item.id !== temporaryId));
      setDraft(previousDraft || message);
      setError(reason instanceof Error ? reason.message : "AI 回答失败，请稍后重试");
    } finally { setBusy(false); }
  }
  const defaultResume = resumes.find((resume) => Boolean(resume.is_default));
  return <section className={`ai-chat-workspace ${historyCollapsed ? "history-collapsed" : ""}`}>
    <aside className="ai-chat-history">
      <header>{!historyCollapsed && <div><span>本地会话</span><b>{conversations.length}</b></div>}<div className="ai-history-actions"><button type="button" className="ai-history-new" onClick={newConversation} title="新对话" aria-label="新建对话">{historyCollapsed ? "＋" : "＋ 新对话"}</button><button type="button" className="ai-history-toggle" onClick={toggleHistory} title={historyCollapsed ? "展开本地会话" : "收起本地会话"} aria-label={historyCollapsed ? "展开本地会话" : "收起本地会话"}>{historyCollapsed ? "»" : "«"}</button></div></header>
      {!historyCollapsed && <><div className="ai-conversation-list">{conversations.length ? conversations.map((conversation) => <article key={conversation.id} className={activeId === conversation.id ? "active" : ""}>
        <button className="ai-conversation-main" type="button" onClick={() => selectConversation(conversation.id)}><b>{conversation.title}</b><span>{conversation.company ? `${conversation.company} · ${conversation.role}` : conversation.resume_title ? `简历 · ${conversation.resume_title}` : "未关联岗位"}</span><small>{conversation.last_message || "尚未开始提问"}</small></button>
        <div><button type="button" onClick={() => renameConversation(conversation)} title="重命名">✎</button><button type="button" onClick={() => deleteConversation(conversation)} title="删除">×</button></div>
      </article>) : <div className="ai-history-empty"><span>✦</span><p>你的第一段求职对话会保存在这里。</p></div>}</div>
      <footer><span>历史记录保存在本机</span><button type="button" onClick={onOpenSettings}>模型设置 →</button></footer></>}
    </aside>
    <article className="ai-chat-panel">
      <header className="ai-chat-context"><div><label>关联岗位<select value={applicationId} onChange={(event) => updateContext("application_id", event.target.value)}><option value="">不关联岗位</option>{applications.map((application) => <option key={application.id} value={application.id}>{application.company} · {application.role}</option>)}</select></label><label>参考简历<select value={resumeId} onChange={(event) => updateContext("resume_id", event.target.value)}><option value="">自动使用默认简历{defaultResume ? ` · ${defaultResume.title}` : ""}</option>{resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.is_default ? "默认 · " : ""}{resume.title}{resume.version ? ` · ${resume.version}` : ""}</option>)}</select></label></div><span className={aiConfig?.configured ? "ready" : "not-ready"}><i />{aiConfig?.configured ? `${aiConfig.model} 已连接` : "AI 尚未配置"}</span></header>
      <div className="ai-quick-prompts">{quickPrompts.map(([label, content]) => <button type="button" key={label} disabled={busy} onClick={() => sendMessage(content)}>{label}</button>)}</div>
      <div className="ai-message-list" ref={messageListRef}>
        {loadingMessages ? <div className="ai-chat-loading">正在读取对话…</div> : messages.length ? messages.map((message) => <article className={`ai-message ${message.role}`} key={message.id}><header><span>{message.role === "assistant" ? "✦ 求职助手" : "我"}</span><time>{formatDate(message.created_at)}</time></header><p>{message.content}</p>{message.role === "assistant" && message.sources?.length > 0 && <footer>{message.sources.map((source, index) => <span key={`${message.id}-${source.type}-${index}`}>{source.label}</span>)}</footer>}</article>) : <div className="ai-chat-empty"><span>✦</span><h2>从一个具体问题开始</h2><p>关联岗位后，我会读取对应的 JD、投递状态、招聘流程和面试复盘；简历未指定时使用默认简历。</p><div>{["比较岗位与简历", "模拟下一轮面试", "整理薄弱知识点"].map((item) => <span key={item}>{item}</span>)}</div></div>}
        {busy && <article className="ai-message assistant thinking"><header><span>✦ 求职助手</span></header><p><i /><i /><i /></p></article>}
      </div>
      <footer className="ai-chat-composer">
        {error && <div className="ai-chat-error"><span>{error}</span>{!aiConfig?.configured && <button type="button" onClick={onOpenSettings}>前往模型设置</button>}</div>}
        <div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} rows={2} maxLength={6000} placeholder="询问岗位匹配、模拟面试、复盘问题或制定准备计划…" /><button type="button" disabled={busy || !draft.trim()} onClick={() => sendMessage()}>{busy ? "…" : "发送 ↑"}</button></div>
        <small>发送时会把当前问题和所选上下文提交给已配置模型；历史记录保存在本机。AI 不会自动修改投递数据。</small>
      </footer>
    </article>
  </section>;
}

function DataView({ storage, onNotify, onReload }: any) {
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState<"" | "save" | "test" | "clear">("");
  const [aiKey, setAiKey] = useState("");
  const [aiMessage, setAiMessage] = useState("");
  const [aiConfig, setAiConfig] = useState<AiConfig>({ provider: "openai", model: "gpt-5.6-terra", base_url: "https://api.openai.com/v1", configured: false, key_source: "" });
  useEffect(() => { request("/ai/config").then(setAiConfig).catch((error) => setAiMessage(error instanceof Error ? error.message : "AI 配置读取失败")); }, []);
  async function backup() { setBusy(true); try { const x = await request("/backup", { method: "POST" }); onNotify(`备份已保存：${x.path}`); } catch (e) { onNotify(e instanceof Error ? e.message : "备份失败"); } finally { setBusy(false); } }
  async function importFile(file?: File) { if (!file) return; try { await request("/import", { method: "POST", body: await file.text() }); await onReload(); onNotify("备份已合并导入"); } catch (e) { onNotify(e instanceof Error ? e.message : "导入失败"); } }
  function aiPayload(clearApiKey = false) {
    return { provider: aiConfig.provider, model: aiConfig.model, base_url: aiConfig.base_url, ...(aiKey.trim() ? { api_key: aiKey.trim() } : {}), ...(clearApiKey ? { clear_api_key: true } : {}) };
  }
  async function saveAiSettings(showToast = true) {
    const next = await request("/ai/config", { method: "POST", body: JSON.stringify(aiPayload()) });
    setAiConfig(next); setAiKey(""); setAiMessage("配置已保存到本机");
    if (showToast) onNotify("AI 模型配置已保存");
    return next as AiConfig;
  }
  async function saveAi() {
    setAiBusy("save");
    try { await saveAiSettings(); }
    catch (error) { const message = error instanceof Error ? error.message : "保存失败"; setAiMessage(message); onNotify(message); }
    finally { setAiBusy(""); }
  }
  async function testAi() {
    if (!aiConfig.configured && !aiKey.trim()) { setAiMessage("请先填写 API Key"); return; }
    setAiBusy("test"); setAiMessage("正在连接模型…");
    try {
      await saveAiSettings(false);
      const result = await request("/ai/test", { method: "POST", body: "{}" });
      setAiMessage(`${result.reply || "连接成功"} · ${result.model}`); onNotify("AI 模型连接成功");
    } catch (error) { const message = error instanceof Error ? error.message : "连接失败"; setAiMessage(message); onNotify(message); }
    finally { setAiBusy(""); }
  }
  async function clearAiKey() {
    setAiBusy("clear");
    try {
      const next = await request("/ai/config", { method: "POST", body: JSON.stringify(aiPayload(true)) });
      setAiConfig(next); setAiKey(""); setAiMessage(next.configured ? "本机密钥已清除，当前仍在使用环境变量中的密钥" : "API Key 已从本机删除"); onNotify("AI 密钥已清除");
    } catch (error) { const message = error instanceof Error ? error.message : "清除失败"; setAiMessage(message); onNotify(message); }
    finally { setAiBusy(""); }
  }
  function changeProvider(provider: AiConfig["provider"]) {
    if (provider === "openai") setAiConfig({ ...aiConfig, provider, model: "gpt-5.6-terra", base_url: "https://api.openai.com/v1" });
    else setAiConfig({ ...aiConfig, provider, model: "", base_url: "" });
    setAiMessage("");
  }
  return <section className="data-grid">
    <article className="panel data-card"><span className="data-icon">▣</span><div><p className="eyebrow">数据库</p><h2>本机持久保存</h2><p>数据库文件：<code>{storage.database || "D:\\222\\data\\autumn-recruitment.db"}</code></p></div></article>
    <article className="panel data-card"><span className="data-icon">⇩</span><div><h2>创建数据库备份</h2><p>生成一份带日期的完整数据库副本，保存至 <code>D:\222\backups</code>。</p><button className="primary" disabled={busy} onClick={backup}>{busy ? "正在备份…" : "立即备份"}</button></div></article>
    <article className="panel data-card"><span className="data-icon">↗</span><div><h2>导出或导入</h2><p>JSON 导出适合迁移和长期归档；导入会与现有记录合并。</p><div className="inline-actions"><a className="secondary compact" href={`${API}/export`} download>导出 JSON</a><label className="secondary compact file-label">导入 JSON<input type="file" accept="application/json" onChange={(e) => importFile(e.target.files?.[0])} /></label></div></div></article>
    <article className="panel ai-settings-card">
      <div className="ai-settings-head"><div><p className="eyebrow">AI MODEL GATEWAY</p><h2>AI 模型接口</h2><p>后续的 JD 解析、简历匹配和面试复盘都会共用这套配置。</p></div><span className={`ai-config-status ${aiConfig.configured ? "ready" : ""}`}><i />{aiConfig.configured ? "已配置" : "未配置"}</span></div>
      <div className="ai-settings-grid">
        <label>提供商<select value={aiConfig.provider} onChange={(event) => changeProvider(event.target.value as AiConfig["provider"])}><option value="openai">OpenAI</option><option value="openai-compatible">OpenAI 兼容接口</option></select></label>
        <label>模型名称<input value={aiConfig.model} onChange={(event) => setAiConfig({ ...aiConfig, model: event.target.value })} placeholder={aiConfig.provider === "openai" ? "gpt-5.6-terra" : "填写服务商的模型 ID"} /></label>
        <label className="full">接口地址<input type="url" value={aiConfig.base_url} onChange={(event) => setAiConfig({ ...aiConfig, base_url: event.target.value })} placeholder="https://api.openai.com/v1" /></label>
        <label className="full">API Key<input type="password" autoComplete="new-password" value={aiKey} onChange={(event) => setAiKey(event.target.value)} placeholder={aiConfig.configured ? "已保存；留空表示不修改" : "粘贴 API Key，仅保存到本机"} /></label>
      </div>
      <div className="ai-settings-actions">{aiConfig.configured && <button className="danger" disabled={Boolean(aiBusy)} onClick={clearAiKey}>清除密钥</button>}<span>{aiMessage || (aiConfig.key_source === "environment" ? "密钥来自环境变量" : "只有主动使用 AI 功能时才会发送相关内容")}</span><button className="secondary compact" disabled={Boolean(aiBusy)} onClick={testAi}>{aiBusy === "test" ? "连接中…" : "测试连接"}</button><button className="primary compact" disabled={Boolean(aiBusy)} onClick={saveAi}>{aiBusy === "save" ? "保存中…" : "保存配置"}</button></div>
      <small className="ai-settings-note">密钥不会返回给网页，也不会写入 GitHub；本机配置保存在 D:\222\data\ai-config.json。</small>
    </article>
    <article className="privacy-note"><b>隐私说明</b><p>工具不含账号系统，不会主动上传任何求职信息。数据库、附件与备份均位于你指定的 D:\222。AI 只会接收你主动发起分析时所需的内容。</p></article>
  </section>;
}

function ScheduleEditor({ value, applications, onClose, onSaved }: any) {
  const [form, setForm] = useState({ ...emptySchedule, ...(value || {}) });
  const [saving, setSaving] = useState(false);
  function field(key: string) { return { value: form[key] ?? "", onChange: (e: any) => setForm({ ...form, [key]: e.target.value }) }; }
  async function submit(e: FormEvent) {
    e.preventDefault(); setSaving(true);
    try { await request(value ? `/schedules/${value.id}` : "/schedules", { method: value ? "PATCH" : "POST", body: JSON.stringify(form) }); onSaved(); }
    catch (error) { alert(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (!value || !confirm("确定删除这条日程吗？")) return;
    await request(`/schedules/${value.id}`, { method: "DELETE" }); onSaved();
  }
  return <Modal title={value ? "编辑日程" : "添加日程"} subtitle="用于截止日期、宣讲会和提醒；笔试、面试、AI面试和测评请在“招聘流程”中填写。" onClose={onClose}><form onSubmit={submit}><div className="form-grid"><label>日程名称 *<input required {...field("title")} placeholder="例如：腾讯提前批投递截止" /></label><label>日程类型<select {...field("event_type")}><option>投递截止</option><option>宣讲会</option><option>结果提醒</option><option>准备任务</option><option>其他</option></select></label><label>时间 *<input required type="datetime-local" {...field("scheduled_at")} /></label><label>提醒<select {...field("reminder")}><option>不提醒</option><option>提前30分钟</option><option>提前1小时</option><option>提前1天</option><option>提前3天</option></select></label><label className="full">关联岗位（可选）<select disabled={!applications.length} {...field("application_id")}><option value="">{applications.length ? "不关联岗位" : "暂无岗位记录，请先在投递管理中新增"}</option>{applications.map((a: Application) => <option key={a.id} value={a.id}>{a.company} · {a.role}</option>)}</select><small className="field-hint">这里显示的是“投递管理”中已经添加的公司与岗位。</small></label><label className="full">地点 / 链接<input {...field("location")} placeholder="会议地址、官网链接或线下地点" /></label><label className="full">备注<textarea rows={4} {...field("notes")} placeholder="需要准备的材料、注意事项等" /></label><label className="schedule-check"><input type="checkbox" checked={Boolean(form.completed)} onChange={(e) => setForm({ ...form, completed: e.target.checked ? 1 : 0 })} /> 标记为已完成</label></div><div className="modal-actions">{value && <button type="button" className="danger" onClick={remove}>删除日程</button>}<span /><button type="button" className="secondary compact" onClick={onClose}>取消</button><button className="primary" disabled={saving}>{saving ? "保存中…" : "保存日程"}</button></div></form></Modal>;
}

function ApplicationEditor({ value, resumes, notify, onClose, onSaved, onDeleted }: any) {
  const [form, setForm] = useState({ ...emptyApp, ...(value || {}) });
  const [saving, setSaving] = useState(false);
  const [analyzingJob, setAnalyzingJob] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [draggingImage, setDraggingImage] = useState(false);
  const [pendingImages, setPendingImages] = useState<{ id: string; file: File; name: string; url: string }[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<string[]>([]);
  const objectUrls = useRef(new Set<string>());
  useEffect(() => () => { objectUrls.current.forEach((url) => URL.revokeObjectURL(url)); }, []);
  const directUrl = externalUrl(form.apply_url);
  const jobAnalysis = useMemo(() => parseAiJobAnalysis(form.ai_analysis), [form.ai_analysis]);
  const defaultResume = resumes.find((resume: Resume) => Boolean(resume.is_default)) || resumes[0];
  const existingImages = (Array.isArray(value?.note_images) ? value.note_images : []).filter((image: any) => !removedImageIds.includes(image.id));
  function field(key: string) { return { value: form[key] ?? "", onChange: (e: any) => setForm({ ...form, [key]: e.target.value }) }; }
  function addImages(files: File[]) {
    const accepted: { id: string; file: File; name: string; url: string }[] = [];
    let rejectedType = false;
    let rejectedSize = false;
    files.forEach((file, index) => {
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) { rejectedType = true; return; }
      if (file.size > 10 * 1024 * 1024) { rejectedSize = true; return; }
      const url = URL.createObjectURL(file);
      objectUrls.current.add(url);
      const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1] || "png";
      const genericName = !file.name || /^image\.(png|jpe?g|webp|gif)$/i.test(file.name);
      accepted.push({ id: crypto.randomUUID(), file, name: genericName ? `截图-${Date.now()}-${index + 1}.${extension}` : file.name, url });
    });
    if (accepted.length) setPendingImages((current) => [...current, ...accepted]);
    if (rejectedType) notify("仅支持 PNG、JPG、WebP 或 GIF 图片");
    else if (rejectedSize) notify("单张图片不能超过 10MB");
  }
  function pasteImages(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    addImages(files);
    notify(`已添加 ${files.length} 张截图，保存投递后写入本机`);
  }
  function dropImages(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggingImage(false);
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
    if (files.length) addImages(files);
  }
  function removePendingImage(id: string) {
    setPendingImages((current) => {
      const target = current.find((image) => image.id === id);
      if (target) { URL.revokeObjectURL(target.url); objectUrls.current.delete(target.url); }
      return current.filter((image) => image.id !== id);
    });
  }
  function fileData(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });
  }
  async function analyzeJob() {
    const jd = String(form.jd || "").trim();
    if (jd.length < 30) { setAnalysisError("请先粘贴较完整的岗位 JD（至少 30 个字符）"); return; }
    if (!resumes.length) { setAnalysisError("简历库为空，请先上传 PDF 或 DOCX 简历"); return; }
    setAnalyzingJob(true);
    setAnalysisError("");
    try {
      const result = await request("/ai/analyze-job", {
        method: "POST",
        body: JSON.stringify({
          company: form.company,
          role: form.role,
          location: form.location,
          salary: form.salary,
          resume_version: form.resume_version,
          resume_id: form.resume_id,
          candidate_context: form.notes,
          jd,
        }),
      });
      setForm((current) => ({ ...current, resume_id: result.resume?.id || current.resume_id, resume_version: current.resume_version || result.resume?.version || result.resume?.title || "", ai_analysis: JSON.stringify(result.analysis) }));
      notify("AI 岗位分析已生成，保存投递后写入本机");
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "AI 分析失败，请稍后重试");
    } finally {
      setAnalyzingJob(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await request(value ? `/applications/${value.id}` : "/applications", { method: value ? "PATCH" : "POST", body: JSON.stringify(form) });
      const applicationId = value?.id || result.id;
      let imageFailures = 0;
      for (const id of removedImageIds) {
        try { await request(`/application-note-images/${id}`, { method: "DELETE" }); }
        catch { imageFailures += 1; }
      }
      for (const image of pendingImages) {
        try {
          await request("/application-note-images", { method: "POST", body: JSON.stringify({ application_id: applicationId, name: image.name, type: image.file.type, data: await fileData(image.file) }) });
        } catch { imageFailures += 1; }
      }
      pendingImages.forEach((image) => { URL.revokeObjectURL(image.url); objectUrls.current.delete(image.url); });
      if (imageFailures) alert(`投递信息已保存，但有 ${imageFailures} 张图片未能完成保存或删除，请重新打开检查。`);
      onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  async function remove() { if (!value || !confirm("确定移入回收站吗？岗位及其招聘流程会保留30天，期间可以恢复。")) return; await request(`/applications/${value.id}`, { method: "DELETE" }); onDeleted(); }
  return <Modal title={value ? "编辑投递" : "新增投递"} subtitle="先记下关键信息，其余内容可以随时补充。" onClose={onClose}>
    <form onSubmit={submit}>
      <div className="form-grid">
        <label>公司名称 *<input required autoFocus {...field("company")} placeholder="例如：字节跳动" /></label>
        <label>岗位名称 *<input required {...field("role")} placeholder="例如：后端开发工程师" /></label>
        <label>当前阶段<select value={form.status} onChange={(e) => { const status = e.target.value; setForm({ ...form, status, applied_at: status === "已投递" ? todayLocalDate() : form.applied_at, rejection_stage: status === "拒绝" ? form.rejection_stage : "" }); }}>{statuses.map((s) => <option key={s}>{s}</option>)}</select></label>
        {form.status === "拒绝" && <label>拒绝阶段 *<select required {...field("rejection_stage")}><option value="">请选择</option>{rejectionStages.map((stage) => <option key={stage}>{stage}</option>)}</select></label>}
        <label>优先级<select {...field("priority")}><option>高</option><option>中</option><option>低</option></select></label>
        <label>工作地点<input {...field("location")} placeholder="北京 / 上海 / 深圳" /></label>
        <label>投递日期<DatePickerField value={String(form.applied_at || "")} onChange={(applied_at) => setForm({ ...form, applied_at })} /></label>
        <label>投递渠道<input {...field("channel")} placeholder="官网 / 内推 / Boss" /></label>
        <label>简历版本<input {...field("resume_version")} placeholder="例如：后端-v3" /></label>
        <label className="full">AI 分析所用简历<select value={form.resume_id} onChange={(event) => { const resume = resumes.find((item: Resume) => item.id === event.target.value); setForm({ ...form, resume_id: event.target.value, resume_version: resume ? (resume.version || resume.title) : "", ai_analysis: "" }); }}><option value="">{resumes.length ? "不指定（简历版本为空时使用默认简历）" : "简历库为空，请先上传简历"}</option>{resumes.map((resume: Resume) => <option key={resume.id} value={resume.id}>{resume.is_default ? "默认 · " : ""}{resume.title}{resume.version ? ` · ${resume.version}` : ""}{resume.target_role ? ` · ${resume.target_role}` : ""}</option>)}</select><small className="field-hint">手动选择优先；未选择且“简历版本”为空时，自动使用默认简历{defaultResume ? `：${defaultResume.title}${defaultResume.version ? ` · ${defaultResume.version}` : ""}` : ""}。点击 AI 分析时会读取该简历的文字内容，并与岗位 JD 一起发送给当前配置的模型。</small></label>
        <label className="full">网申或 JD 链接<div className="url-field-row"><input type="text" inputMode="url" {...field("apply_url")} placeholder="https://" />{directUrl && <a className="url-open-action" href={directUrl} target="_blank" rel="noopener noreferrer">↗ 一键直达</a>}</div></label>
        <label>薪资信息<input {...field("salary")} placeholder="选填" /></label>
        <label>内推人 / 联系方式<input {...field("referral")} placeholder="选填" /></label>
        <div className="full ai-jd-field">
          <div className="ai-jd-heading"><label htmlFor="application-jd">岗位 JD</label><button type="button" className="ai-analyze-button" disabled={analyzingJob} onClick={analyzeJob}>{analyzingJob ? "正在分析…" : jobAnalysis ? "✦ 重新分析" : "✦ AI 分析岗位"}</button></div>
          <textarea id="application-jd" rows={6} {...field("jd")} placeholder="粘贴完整岗位职责、任职要求和加分项，内容越完整，分析越准确。" />
          <small className="ai-jd-hint">仅在点击分析时发送当前岗位信息和所选简历的文字内容；分析结果会随投递记录保存在本机。</small>
          {analysisError && <p className="ai-analysis-error" role="alert">{analysisError}</p>}
          {jobAnalysis && <article className="ai-analysis-result">
            <header><div><span>AI 岗位分析</span><h3>{jobAnalysis.summary}</h3></div><button type="button" onClick={() => { setForm({ ...form, ai_analysis: "" }); setAnalysisError(""); }}>清除分析</button></header>
            {jobAnalysis.fit_assessment && <div className="ai-fit-assessment"><b>匹配判断</b><p>{jobAnalysis.fit_assessment}</p></div>}
            <div className="ai-analysis-grid">
              <AiAnalysisList title="核心技能" items={jobAnalysis.core_skills} />
              <AiAnalysisList title="主要职责" items={jobAnalysis.responsibilities} />
              <AiAnalysisList title="简历建议" items={jobAnalysis.resume_suggestions} />
              <AiAnalysisList title="面试方向" items={jobAnalysis.interview_questions} />
              <AiAnalysisList title="准备清单" items={jobAnalysis.preparation_checklist} wide />
            </div>
            <footer><span>{jobAnalysis.model || "AI 模型"}{jobAnalysis.resume_title ? ` · ${jobAnalysis.resume_title}` : ""}</span><time dateTime={jobAnalysis.generated_at}>{jobAnalysis.generated_at ? `生成于 ${formatDate(jobAnalysis.generated_at)}` : "分析结果待保存"}</time></footer>
          </article>}
        </div>
        <div className="full note-field">
          <label>备注<textarea rows={4} {...field("notes")} onPaste={pasteImages} placeholder="业务方向、准备重点、沟通记录…也可以在这里直接粘贴截图" /></label>
          <div className={`note-image-drop ${draggingImage ? "dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDraggingImage(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDraggingImage(false)} onDrop={dropImages}>
            <span className="note-image-drop-icon">▧</span>
            <span><b>粘贴、拖入或选择图片</b><small>支持 PNG、JPG、WebP、GIF，单张最大 10MB</small></span>
            <label className="secondary compact file-label">选择图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(event) => { addImages(Array.from(event.target.files || [])); event.target.value = ""; }} /></label>
          </div>
          {(existingImages.length > 0 || pendingImages.length > 0) && <div className="note-image-grid">
            {existingImages.map((image: any) => <article className="note-image-card" key={image.id}>
              <a href={`${API}/application-note-images/${image.id}`} target="_blank" rel="noreferrer" title="打开原图"><img src={`${API}/application-note-images/${image.id}`} alt={image.original_name || "备注图片"} loading="lazy" /></a>
              <footer><span title={image.original_name}>{image.original_name}<small>{Math.max(1, Math.ceil(Number(image.size || 0) / 1024))} KB</small></span><button type="button" onClick={() => setRemovedImageIds((current) => [...current, image.id])} aria-label={`删除 ${image.original_name}`}>×</button></footer>
            </article>)}
            {pendingImages.map((image) => <article className="note-image-card pending" key={image.id}>
              <img src={image.url} alt={image.name} />
              <footer><span title={image.name}>{image.name}<small>待保存</small></span><button type="button" onClick={() => removePendingImage(image.id)} aria-label={`移除 ${image.name}`}>×</button></footer>
            </article>)}
          </div>}
        </div>
      </div>
      <div className="modal-actions">{value && <button type="button" className="danger" onClick={remove}>删除记录</button>}<span /><button type="button" className="secondary compact" onClick={onClose}>取消</button><button className="primary" disabled={saving}>{saving ? "保存中…" : "保存投递"}</button></div>
    </form>
  </Modal>;
}

function AiAnalysisList({ title, items, wide = false }: { title: string; items?: string[]; wide?: boolean }) {
  if (!Array.isArray(items) || !items.length) return null;
  return <section className={wide ? "wide" : ""}><h4>{title}</h4><ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul></section>;
}

function SessionEditor({ value, applications, sessions, initialApplication, onClose, onSaved, onRefresh, notify }: any) {
  function recommendRound(applicationId: string) {
    const used = sessions.filter((s: Session) => s.application_id === applicationId && s.type === "面试").map((s: Session) => s.round);
    return interviewRounds.find((round) => !used.includes(round)) || "终面";
  }
  const [form, setForm] = useState({ ...emptySession, application_id: initialApplication || "", round: initialApplication ? recommendRound(initialApplication) : emptySession.round, ...(value || {}), questions: value?.questions || [] }); const [saving, setSaving] = useState(false); const [exporting, setExporting] = useState(false);
  const roundOptionsByType: Record<string, string[]> = { "笔试": examRounds, "面试": interviewRounds, "AI面试": aiInterviewRounds, "测评": assessmentRounds };
  const roundOptions = roundOptionsByType[form.type] || [form.type];
  const roundFieldLabels: Record<string, string> = { "笔试": "笔试类型", "面试": "面试轮次", "AI面试": "AI面试类型", "测评": "测评类型" };
  const platformFieldLabels: Record<string, string> = { "笔试": "笔试平台 / 说明", "面试": "面试官 / 部门", "AI面试": "AI面试平台 / 说明", "测评": "测评平台 / 说明" };
  const customRoundPlaceholders: Record<string, string> = { "笔试": "例如：线下编程笔试", "面试": "例如：主管面 / 交叉面", "AI面试": "例如：AI英语面试", "测评": "例如：职业能力测评" };
  function defaultRound(type: string, applicationId: string) {
    if (type === "面试") return recommendRound(applicationId);
    return (roundOptionsByType[type] || [type])[0];
  }
  const customRound = !roundOptions.includes(form.round);
  function field(key: string) { return { value: form[key] ?? "", onChange: (e: any) => setForm({ ...form, [key]: e.target.value }) }; }
  function updateQuestion(index: number, key: string, val: any) { const next = [...form.questions]; next[index] = { ...next[index], [key]: val }; setForm({ ...form, questions: next }); }
  async function submit(e: FormEvent) { e.preventDefault(); setSaving(true); try { const result = await request(value ? `/sessions/${value.id}` : "/sessions", { method: value ? "PATCH" : "POST", body: JSON.stringify(form) }); if (!value && result.id) { notify("记录已创建，可以继续添加附件"); } onSaved(); } catch (err) { alert(err instanceof Error ? err.message : "保存失败"); } finally { setSaving(false); } }
  async function upload(file?: File) { if (!file || !value) return; if (file.size > 10 * 1024 * 1024) return notify("单个附件不能超过 10MB"); const reader = new FileReader(); reader.onload = async () => { try { const data = String(reader.result).split(",")[1]; await request("/attachments", { method: "POST", body: JSON.stringify({ session_id: value.id, name: file.name, type: file.type, data }) }); await onRefresh(value.id); notify("附件已保存"); } catch (e) { notify(e instanceof Error ? e.message : "上传失败"); } }; reader.readAsDataURL(file); }
  async function removeAttachment(id: string) { await request(`/attachments/${id}`, { method: "DELETE" }); await onRefresh(value.id); notify("附件已删除"); }
  async function remove() { if (!value || !confirm("确定删除这次招聘流程及其题目和附件吗？")) return; await request(`/sessions/${value.id}`, { method: "DELETE" }); onSaved(); }
  async function exportPdf() {
    if (!value || exporting) return;
    setExporting(true);
    try {
      const response = await fetch(`${API}/sessions/${value.id}/questions.pdf`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "导出失败"); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName = `${value.company}-${form.round || form.type}-题目复盘`.replace(/[<>:"/\\|?*]+/g, "_");
      link.href = url; link.download = `${safeName}.pdf`; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(`已导出 ${form.questions.length} 道题目`);
    } catch (error) { notify(error instanceof Error ? error.message : "PDF 导出失败"); }
    finally { setExporting(false); }
  }
  return <Modal wide title={value ? `${value.company} · ${value.round || value.type}` : "添加招聘流程"} subtitle="笔试、面试、AI面试和测评都可以单独记录时间、结果与复盘。" onClose={onClose}>
    <form onSubmit={submit}>
      <div className="process-intro">
        <i>1</i><span><b>选择流程类型</b><small>面试自动推荐轮次，其他类型可选择或自定义名称</small></span>
        <i>2</i><span><b>填写准确时间</b><small>保存后会同步显示在投递进度和近期日程中</small></span>
        <i>3</i><span><b>结束后补充复盘</b><small>记录问题、回答、结果和改进点</small></span>
      </div>
      <div className="form-grid session-fields">
        <label>对应岗位 *
          <select required value={form.application_id} onChange={(e) => setForm({ ...form, application_id: e.target.value, round: defaultRound(form.type, e.target.value) })}>
            <option value="">请选择</option>
            {applications.map((a: Application) => <option key={a.id} value={a.id}>{a.company} · {a.role}</option>)}
          </select>
        </label>
        <label>流程类型 *
          <select value={form.type} onChange={(e) => { const type = e.target.value; setForm({ ...form, type, round: defaultRound(type, form.application_id), format: type === "面试" ? "视频" : "在线" }); }}>
            {sessionTypes.map((type) => <option key={type}>{type}</option>)}
          </select>
        </label>
        <label>{roundFieldLabels[form.type] || "流程名称"} *
          <select value={customRound ? "__custom" : form.round} onChange={(e) => setForm({ ...form, round: e.target.value === "__custom" ? "" : e.target.value })}>
            {roundOptions.map((round) => <option key={round}>{round}</option>)}
            <option value="__custom">自定义名称…</option>
          </select>
          {customRound && <input className="custom-round-input" required autoFocus value={form.round} onChange={(e) => setForm({ ...form, round: e.target.value })} placeholder={customRoundPlaceholders[form.type] || "请输入流程名称"} />}
        </label>
        <label>计划时间 *<input required type="datetime-local" {...field("scheduled_at")} /></label>
        <label>形式<input {...field("format")} placeholder="视频 / 现场 / 在线" /></label>
        <label>时长（分钟）<input type="number" min="0" {...field("duration")} /></label>
        <label>地点 / 会议链接<input {...field("location")} /></label>
        <label>{platformFieldLabels[form.type] || "平台 / 说明"}<input {...field("interviewer")} /></label>
        <label>进展 / 结果<select {...field("result")}><option>待进行</option><option>已完成（待结果）</option><option>通过</option><option>未通过</option><option>候补</option><option>已改期</option><option>已取消</option>{form.result === "待定" && <option>待定</option>}</select></label>
        <label>综合评分<select {...field("rating")}><option value="0">未评分</option><option value="1">1 / 5</option><option value="2">2 / 5</option><option value="3">3 / 5</option><option value="4">4 / 5</option><option value="5">5 / 5</option></select></label>
      </div>
    <div className="section-heading"><div><p className="eyebrow">具体内容</p><h3>题目与回答</h3></div>{value && <button type="button" className="secondary compact" disabled={exporting} onClick={exportPdf}>⇩ {exporting ? "导出中…" : "导出 PDF"}</button>}</div>
    <div className="question-list">{form.questions.length ? form.questions.map((q: Question, i: number) => <article className="question-editor" key={q.id || i}><header><b>问题 {i + 1}</b><button type="button" onClick={() => setForm({ ...form, questions: form.questions.filter((_: any, n: number) => n !== i) })}>移除</button></header><label>问了什么？<textarea rows={2} value={q.content} onChange={(e) => updateQuestion(i, "content", e.target.value)} placeholder="尽量还原题目和追问…" /></label><div><label>我的回答<textarea rows={3} value={q.answer} onChange={(e) => updateQuestion(i, "answer", e.target.value)} /></label><label>参考答案 / 更好的回答<textarea rows={3} value={q.reference_answer} onChange={(e) => updateQuestion(i, "reference_answer", e.target.value)} /></label></div><footer><input value={q.category} onChange={(e) => updateQuestion(i, "category", e.target.value)} placeholder="标签：算法 / 项目 / 八股" /><label><input type="checkbox" checked={Boolean(q.needs_review)} onChange={(e) => updateQuestion(i, "needs_review", e.target.checked ? 1 : 0)} /> 加入待复习</label></footer></article>) : <button type="button" className="question-empty" onClick={() => setForm({ ...form, questions: [{ content: "", answer: "", reference_answer: "", category: "", needs_review: 0 }] })}>＋ 添加第一道题目</button>}</div>
    {Boolean(form.questions.length) && <div className="question-list-footer"><button type="button" className="secondary compact" onClick={() => setForm({ ...form, questions: [...form.questions, { content: "", answer: "", reference_answer: "", category: "", needs_review: 0 }] })}>＋ 添加下一道题目</button></div>}
    <div className="form-grid notes-grid"><label className="full">整体流程与感受<textarea rows={4} {...field("overall_notes")} placeholder="流程体验、题目难度、整体表现…" /></label><label className="full">没答好的地方与下次改进<textarea rows={4} {...field("improvements")} placeholder="需要复习的知识点、表达方式、下一步行动…" /></label></div>
    {value && <section className="attachments"><div className="section-heading"><div><p className="eyebrow">本机附件</p><h3>截图、题目与资料</h3></div><label className="secondary compact file-label">＋ 添加附件<input type="file" onChange={(e) => upload(e.target.files?.[0])} /></label></div>{value.attachments?.length ? <div className="attachment-list">{value.attachments.map((a) => <div key={a.id}><a href={`${API}/attachments/${a.id}`} target="_blank" rel="noreferrer">{a.original_name}<small>{Math.ceil(a.size / 1024)} KB</small></a><button type="button" onClick={() => removeAttachment(a.id)}>删除</button></div>)}</div> : <p className="muted">暂无附件，单个文件最大 10MB。</p>}</section>}
    <div className="modal-actions">{value && <button type="button" className="danger" onClick={remove}>删除本次流程</button>}<span /><button type="button" className="secondary compact" onClick={onClose}>取消</button><button className="primary" disabled={saving}>{saving ? "保存中…" : "保存招聘流程"}</button></div></form></Modal>;
}

function Modal({ title, subtitle, onClose, wide, children }: any) { return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true"><header><div><p className="eyebrow">秋招手账</p><h2>{title}</h2><span>{subtitle}</span></div><button className="close" onClick={onClose} aria-label="关闭">×</button></header>{children}</section></div>; }
function Empty({ title, text, action, onClick, compact }: any) { return <div className={`empty ${compact ? "compact-empty" : ""}`}><i>✦</i><b>{title}</b><p>{text}</p>{action && <button className="secondary compact" onClick={onClick}>{action}</button>}</div>; }
