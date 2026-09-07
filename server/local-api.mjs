import http from "node:http";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const PORT = Number(process.env.AUTUMN_API_PORT || 4311);
const DATA_ROOT = process.env.AUTUMN_DATA_DIR || "D:\\222";
const DB_DIR = path.join(DATA_ROOT, "data");
const ATTACHMENTS_DIR = path.join(DATA_ROOT, "attachments");
const RESUMES_DIR = path.join(DATA_ROOT, "resumes");
const BACKUPS_DIR = path.join(DATA_ROOT, "backups");

for (const folder of [DATA_ROOT, DB_DIR, ATTACHMENTS_DIR, RESUMES_DIR, BACKUPS_DIR]) mkdirSync(folder, { recursive: true });

const dbPath = path.join(DB_DIR, "autumn-recruitment.db");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL DEFAULT '',
    apply_url TEXT NOT NULL DEFAULT '',
    applied_at TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '准备投递',
    rejection_stage TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT '中',
    salary TEXT NOT NULL DEFAULT '',
    jd TEXT NOT NULL DEFAULT '',
    referral TEXT NOT NULL DEFAULT '',
    resume_version TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    deleted_at TEXT NOT NULL DEFAULT '',
    link_check_status TEXT NOT NULL DEFAULT '',
    link_check_message TEXT NOT NULL DEFAULT '',
    link_checked_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);
const applicationSchema = db.prepare("PRAGMA table_info(applications)").all();
if (!applicationSchema.some((column) => column.name === "rejection_stage")) {
  db.exec("ALTER TABLE applications ADD COLUMN rejection_stage TEXT NOT NULL DEFAULT ''");
}
for (const [column, definition] of [
  ["deleted_at", "TEXT NOT NULL DEFAULT ''"],
  ["link_check_status", "TEXT NOT NULL DEFAULT ''"],
  ["link_check_message", "TEXT NOT NULL DEFAULT ''"],
  ["link_checked_at", "TEXT NOT NULL DEFAULT ''"],
]) {
  if (!applicationSchema.some((item) => item.name === column)) db.exec("ALTER TABLE applications ADD COLUMN " + column + " " + definition);
}
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '面试',
    round TEXT NOT NULL DEFAULT '',
    scheduled_at TEXT NOT NULL DEFAULT '',
    duration INTEGER NOT NULL DEFAULT 0,
    format TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    interviewer TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL DEFAULT '待定',
    notification_date TEXT NOT NULL DEFAULT '',
    overall_notes TEXT NOT NULL DEFAULT '',
    improvements TEXT NOT NULL DEFAULT '',
    rating INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    answer TEXT NOT NULL DEFAULT '',
    reference_answer TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    needs_review INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS resumes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '',
    target_role TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS schedule_events (
    id TEXT PRIMARY KEY,
    application_id TEXT,
    title TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT '其他',
    scheduled_at TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    reminder TEXT NOT NULL DEFAULT '提前1天',
    notes TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status)");
db.exec("CREATE INDEX IF NOT EXISTS idx_applications_deleted_at ON applications(deleted_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_application_date ON sessions(application_id, scheduled_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_questions_session_order ON questions(session_id, sort_order)");
db.exec("CREATE INDEX IF NOT EXISTS idx_schedule_events_date ON schedule_events(scheduled_at)");
db.exec("PRAGMA optimize");

const rejectionStages = new Set(["初筛挂", "笔试挂", "测评挂", "一面挂", "二面挂", "三面挂"]);
const applicationColumns = ["company", "role", "location", "channel", "apply_url", "applied_at", "status", "rejection_stage", "priority", "salary", "jd", "referral", "resume_version", "notes"];
const applicationStorageColumns = [...applicationColumns, "deleted_at", "link_check_status", "link_check_message", "link_checked_at"];
const sessionColumns = ["application_id", "type", "round", "scheduled_at", "duration", "format", "location", "interviewer", "result", "notification_date", "overall_notes", "improvements", "rating"];
const scheduleColumns = ["application_id", "title", "event_type", "scheduled_at", "location", "reminder", "notes", "completed"];

function now() { return new Date().toISOString(); }
function clean(value, fallback = "") { return typeof value === "string" ? value.trim() : fallback; }
function json(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000") {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 16 * 1024 * 1024) throw new Error("请求内容超过 16MB");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function rows(statement, ...params) { return statement.all(...params); }
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const closedLinkPhrases = [
  "职位已关闭", "该职位已关闭", "职位已下线", "该职位已下线", "职位已失效", "该职位已失效",
  "岗位已关闭", "该岗位已关闭", "岗位已下线", "该岗位已下线", "岗位不存在", "职位不存在",
  "招聘已结束", "已结束招聘", "已停止招聘", "停止招聘", "投递已结束", "申请已截止", "职位已过期",
  "job has expired", "job is no longer available", "position has been closed", "position is no longer available",
];
const browserChallengePhrases = [
  "安全验证", "请完成验证", "验证码", "访问受限", "请求被拦截", "操作过于频繁",
  "无法访问此网站", "无法访问此网页", "您的连接不是私密连接", "err_name_not_resolved",
  "this site can't be reached", "this site can’t be reached", "access denied", "verify you are human",
  "checking your browser", "too many requests", "captcha",
];
const browserExecutable = [
  process.env.AUTUMN_BROWSER_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate) => candidate && existsSync(candidate));

function normalizedWebUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : "https://" + raw;
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(parsed.hostname)) return "";
    return parsed.href;
  } catch { return ""; }
}

async function responseSnippet(response, limit = 180000) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text.slice(0, limit).toLowerCase();
}

async function inspectApplicationLink(application) {
  const target = normalizedWebUrl(application.apply_url);
  if (!target) return { id: application.id, company: application.company, role: application.role, url: application.apply_url, status: "invalid", label: "链接无效", message: "链接格式无法识别" };
  try {
    const response = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" },
    });
    const base = { id: application.id, company: application.company, role: application.role, url: target, http_status: response.status, final_url: response.url || target };
    if ([404, 410].includes(response.status)) return { ...base, status: "invalid", label: "链接失效", message: "网页返回 " + response.status };
    if (!response.ok) return { ...base, status: "review", label: "需要复核", message: "网页返回 " + response.status + "，可能需要登录或暂时限制访问" };
    const contentType = response.headers.get("content-type") || "";
    if (/text|html|json|javascript/i.test(contentType)) {
      const snippet = await responseSnippet(response);
      const phrase = closedLinkPhrases.find((item) => snippet.includes(item));
      if (phrase) return { ...base, status: "closed", label: "招聘已关闭", message: "页面包含“" + phrase + "”" };
    }
    return { ...base, status: "valid", label: "正常", message: "链接可以访问" };
  } catch (error) {
    const message = error && error.name === "TimeoutError" ? "访问超时" : "无法访问，可能是网络限制或网站拦截";
    return { id: application.id, company: application.company, role: application.role, url: target, status: "review", label: "需要复核", message };
  }
}

function browserPageText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function inspectApplicationLinkInBrowser(application) {
  const target = normalizedWebUrl(application.apply_url);
  const base = { id: application.id, company: application.company, role: application.role, url: target };
  if (!target || !browserExecutable) {
    return { ...base, status: "review", label: "需要复核", message: browserExecutable ? "链接格式无法识别" : "自动检查受限，且未找到可用的 Chrome 或 Edge" };
  }

  const profileDir = mkdtempSync(path.join(os.tmpdir(), "autumn-link-check-"));
  try {
    const result = await new Promise((resolve) => {
      const child = spawn(browserExecutable, [
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-default-apps",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--mute-audio",
        `--user-data-dir=${profileDir}`,
        "--virtual-time-budget=10000",
        "--dump-dom",
        target,
      ], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      let html = "";
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      child.stdout.on("data", (chunk) => {
        if (html.length < 400000) html += chunk.toString("utf8");
      });
      child.on("error", () => finish({ ok: false, timeout: false, html }));
      child.on("close", (code) => finish({ ok: code === 0, timeout: false, html }));
      const timer = setTimeout(() => {
        child.kill();
        finish({ ok: false, timeout: true, html });
      }, 18000);
    });

    const text = browserPageText(result.html || "");
    const closedPhrase = closedLinkPhrases.find((phrase) => text.includes(phrase));
    if (closedPhrase) return { ...base, status: "closed", label: "招聘已关闭", message: `真实浏览器页面包含“${closedPhrase}”`, inspection_method: "browser" };
    const challengePhrase = browserChallengePhrases.find((phrase) => text.includes(phrase));
    if (challengePhrase) return { ...base, status: "review", label: "需要复核", message: "网站要求安全验证，请手动打开确认", inspection_method: "browser" };
    if (result.ok && text.length >= 40) return { ...base, status: "valid", label: "正常", message: "已通过真实浏览器成功打开", inspection_method: "browser" };
    return { ...base, status: "review", label: "需要复核", message: result.timeout ? "真实浏览器复查超时，请手动打开确认" : "真实浏览器未能完整加载，请手动打开确认", inspection_method: "browser" };
  } finally {
    try { rmSync(profileDir, { recursive: true, force: true }); }
    catch { /* Chrome may hold its temporary profile briefly while shutting down. */ }
  }
}

function permanentlyDeleteApplications(ids) {
  const uniqueIds = [...new Set(ids.filter((id) => typeof id === "string" && id))].slice(0, 500);
  if (!uniqueIds.length) return 0;
  const placeholders = uniqueIds.map(() => "?").join(",");
  const files = rows(db.prepare("SELECT t.stored_name FROM attachments t JOIN sessions s ON s.id=t.session_id JOIN applications a ON a.id=s.application_id WHERE a.deleted_at<>'' AND a.id IN (" + placeholders + ")"), ...uniqueIds);
  db.exec("BEGIN");
  let changes = 0;
  try {
    db.prepare("DELETE FROM schedule_events WHERE application_id IN (" + placeholders + ")").run(...uniqueIds);
    changes = db.prepare("DELETE FROM applications WHERE deleted_at<>'' AND id IN (" + placeholders + ")").run(...uniqueIds).changes;
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  files.forEach((file) => {
    const target = path.join(ATTACHMENTS_DIR, file.stored_name);
    if (existsSync(target)) unlinkSync(target);
  });
  return changes;
}

function purgeExpiredTrash() {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_MS).toISOString();
  const expired = rows(db.prepare("SELECT id FROM applications WHERE deleted_at<>'' AND deleted_at<=?"), cutoff).map((item) => item.id);
  return permanentlyDeleteApplications(expired);
}

function getState() {
  purgeExpiredTrash();
  const applications = rows(db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM sessions s WHERE s.application_id = a.id) AS session_count,
      (SELECT MIN(s.scheduled_at) FROM sessions s WHERE s.application_id = a.id AND s.scheduled_at >= datetime('now','localtime')) AS next_session_at
    FROM applications a WHERE a.deleted_at='' ORDER BY a.updated_at DESC
  `));
  const sessions = rows(db.prepare(`
    SELECT s.*, a.company, a.role,
      (SELECT COUNT(*) FROM questions q WHERE q.session_id = s.id) AS question_count,
      (SELECT COUNT(*) FROM attachments t WHERE t.session_id = s.id) AS attachment_count
    FROM sessions s JOIN applications a ON a.id = s.application_id AND a.deleted_at=''
    ORDER BY CASE WHEN s.scheduled_at = '' THEN 1 ELSE 0 END, s.scheduled_at DESC
  `));
  const resumes = rows(db.prepare("SELECT id,title,version,target_role,notes,original_name,mime_type,size,created_at,updated_at FROM resumes ORDER BY updated_at DESC"));
  const schedules = rows(db.prepare("SELECT e.*,a.company,a.role FROM schedule_events e LEFT JOIN applications a ON a.id=e.application_id WHERE e.application_id IS NULL OR a.deleted_at='' ORDER BY e.scheduled_at DESC"));
  const trash = rows(db.prepare("SELECT a.*, (SELECT COUNT(*) FROM sessions s WHERE s.application_id=a.id) AS session_count FROM applications a WHERE a.deleted_at<>'' ORDER BY a.deleted_at DESC"));
  return { applications, sessions, resumes, schedules, trash, trash_retention_days: 30, storage: { root: DATA_ROOT, database: dbPath } };
}
function getSession(id) {
  const session = db.prepare("SELECT s.*, a.company, a.role FROM sessions s JOIN applications a ON a.id=s.application_id AND a.deleted_at='' WHERE s.id=?").get(id);
  if (!session) return null;
  return {
    ...session,
    questions: rows(db.prepare("SELECT * FROM questions WHERE session_id=? ORDER BY sort_order, id"), id),
    attachments: rows(db.prepare("SELECT id, session_id, original_name, mime_type, size, created_at FROM attachments WHERE session_id=? ORDER BY created_at DESC"), id),
  };
}
function saveQuestions(sessionId, questions = []) {
  db.prepare("DELETE FROM questions WHERE session_id=?").run(sessionId);
  const insert = db.prepare("INSERT INTO questions (id,session_id,content,answer,reference_answer,category,needs_review,sort_order) VALUES (?,?,?,?,?,?,?,?)");
  questions.forEach((q, index) => insert.run(q.id || randomUUID(), sessionId, clean(q.content), clean(q.answer), clean(q.reference_answer), clean(q.category), q.needs_review ? 1 : 0, index));
}
function safeAttachmentName(name) {
  const base = path.basename(name).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 100);
  return base || "attachment";
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.end();
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const pathname = url.pathname;
  try {
    if (req.method === "GET" && pathname === "/api/health") return json(res, 200, { ok: true, database: dbPath });
    if (req.method === "GET" && pathname === "/api/state") return json(res, 200, getState());

    if (req.method === "POST" && pathname === "/api/applications/check-links") {
      const applications = rows(db.prepare("SELECT id,company,role,apply_url FROM applications WHERE deleted_at='' AND apply_url<>'' ORDER BY updated_at DESC"));
      const results = [];
      for (let index = 0; index < applications.length; index += 8) {
        results.push(...await Promise.all(applications.slice(index, index + 8).map(inspectApplicationLink)));
      }
      const applicationsById = new Map(applications.map((application) => [application.id, application]));
      const reviewIndexes = results.map((item, index) => item.status === "review" ? index : -1).filter((index) => index >= 0);
      for (let index = 0; index < reviewIndexes.length; index += 3) {
        const indexes = reviewIndexes.slice(index, index + 3);
        const checked = await Promise.all(indexes.map((resultIndex) => inspectApplicationLinkInBrowser(applicationsById.get(results[resultIndex].id))));
        checked.forEach((item, checkedIndex) => { results[indexes[checkedIndex]] = item; });
      }
      const stamp = now();
      const update = db.prepare("UPDATE applications SET link_check_status=?,link_check_message=?,link_checked_at=? WHERE id=? AND deleted_at=''");
      results.forEach((item) => update.run(item.status, item.message, stamp, item.id));
      return json(res, 200, {
        checked: results.length,
        results,
        summary: {
          valid: results.filter((item) => item.status === "valid").length,
          invalid: results.filter((item) => item.status === "invalid").length,
          closed: results.filter((item) => item.status === "closed").length,
          review: results.filter((item) => item.status === "review").length,
        },
      });
    }

    const linkCheckValidMatch = pathname.match(/^\/api\/applications\/([^/]+)\/link-check-valid$/);
    if (req.method === "POST" && linkCheckValidMatch) {
      const stamp = now();
      const result = db.prepare("UPDATE applications SET link_check_status='valid',link_check_message='已人工确认链接正常',link_checked_at=? WHERE id=? AND deleted_at=''").run(stamp, linkCheckValidMatch[1]);
      return json(res, result.changes ? 200 : 404, result.changes ? { ok: true, status: "valid", label: "正常", message: "已人工确认链接正常", checked_at: stamp } : { error: "投递记录不存在" });
    }

    if (req.method === "POST" && pathname === "/api/applications/trash") {
      const body = await readJson(req);
      const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).filter((id) => typeof id === "string" && id))].slice(0, 500);
      if (!ids.length) return json(res, 400, { error: "请选择要移入回收站的投递记录" });
      const placeholders = ids.map(() => "?").join(",");
      const result = db.prepare("UPDATE applications SET deleted_at=?,updated_at=? WHERE deleted_at='' AND id IN (" + placeholders + ")").run(now(), now(), ...ids);
      return json(res, 200, { ok: true, moved: result.changes });
    }

    const trashMatch = pathname.match(/^\/api\/trash\/([^/]+)$/);
    if (trashMatch && req.method === "POST") {
      const result = db.prepare("UPDATE applications SET deleted_at='',updated_at=? WHERE id=? AND deleted_at<>''").run(now(), trashMatch[1]);
      return json(res, result.changes ? 200 : 404, { ok: Boolean(result.changes) });
    }
    if (trashMatch && req.method === "DELETE") {
      const changes = permanentlyDeleteApplications([trashMatch[1]]);
      return json(res, changes ? 200 : 404, { ok: Boolean(changes) });
    }
    if (pathname === "/api/trash" && req.method === "DELETE") {
      const ids = rows(db.prepare("SELECT id FROM applications WHERE deleted_at<>''")).map((item) => item.id);
      const changes = permanentlyDeleteApplications(ids);
      return json(res, 200, { ok: true, deleted: changes });
    }

    if (req.method === "POST" && pathname === "/api/applications") {
      const body = await readJson(req);
      if (!clean(body.company) || !clean(body.role)) return json(res, 400, { error: "公司和岗位不能为空" });
      const status = clean(body.status, "准备投递");
      const rejectionStage = status === "拒绝" && rejectionStages.has(clean(body.rejection_stage)) ? clean(body.rejection_stage) : "";
      const id = randomUUID();
      const stamp = now();
      db.prepare(`INSERT INTO applications (id,${applicationColumns.join(",")},created_at,updated_at) VALUES (${["?", ...applicationColumns.map(() => "?"), "?", "?"].join(",")})`)
        .run(id, ...applicationColumns.map((key) => key === "priority" ? clean(body[key], "中") : key === "status" ? status : key === "rejection_stage" ? rejectionStage : clean(body[key])), stamp, stamp);
      return json(res, 201, { id });
    }
    const appMatch = pathname.match(/^\/api\/applications\/([^/]+)$/);
    if (appMatch && req.method === "PATCH") {
      const body = await readJson(req);
      if (Object.hasOwn(body, "status")) {
        const status = clean(body.status);
        if (status !== "拒绝") body.rejection_stage = "";
        else if (!Object.hasOwn(body, "rejection_stage")) body.rejection_stage = "";
      }
      if (Object.hasOwn(body, "rejection_stage")) {
        const stage = clean(body.rejection_stage);
        if (stage && !rejectionStages.has(stage)) return json(res, 400, { error: "请选择有效的拒绝阶段" });
      }
      const sets = applicationColumns.filter((key) => Object.hasOwn(body, key));
      if (!sets.length) return json(res, 400, { error: "没有可更新的字段" });
      const values = sets.map((key) => clean(body[key]));
      db.prepare(`UPDATE applications SET ${sets.map((key) => `${key}=?`).join(",")}, updated_at=? WHERE id=?`).run(...values, now(), appMatch[1]);
      return json(res, 200, { ok: true });
    }
    if (appMatch && req.method === "DELETE") {
      const stamp = now();
      const result = db.prepare("UPDATE applications SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at=''").run(stamp, stamp, appMatch[1]);
      return json(res, result.changes ? 200 : 404, { ok: Boolean(result.changes) });
    }

    if (req.method === "POST" && pathname === "/api/sessions") {
      const body = await readJson(req);
      if (!clean(body.application_id)) return json(res, 400, { error: "请选择对应岗位" });
      const id = randomUUID();
      const stamp = now();
      db.exec("BEGIN");
      try {
        db.prepare(`INSERT INTO sessions (id,${sessionColumns.join(",")},created_at,updated_at) VALUES (${["?", ...sessionColumns.map(() => "?"), "?", "?"].join(",")})`)
          .run(id, ...sessionColumns.map((key) => ["duration", "rating"].includes(key) ? Number(body[key] || 0) : key === "type" ? clean(body[key], "面试") : key === "result" ? clean(body[key], "待定") : clean(body[key])), stamp, stamp);
        saveQuestions(id, body.questions || []);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return json(res, 201, { id });
    }
    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch && req.method === "GET") {
      const session = getSession(sessionMatch[1]);
      return session ? json(res, 200, session) : json(res, 404, { error: "记录不存在" });
    }
    if (sessionMatch && req.method === "PATCH") {
      const body = await readJson(req);
      const sets = sessionColumns.filter((key) => Object.hasOwn(body, key));
      db.exec("BEGIN");
      try {
        if (sets.length) db.prepare(`UPDATE sessions SET ${sets.map((key) => `${key}=?`).join(",")}, updated_at=? WHERE id=?`)
          .run(...sets.map((key) => ["duration", "rating"].includes(key) ? Number(body[key] || 0) : clean(body[key])), now(), sessionMatch[1]);
        if (Array.isArray(body.questions)) saveQuestions(sessionMatch[1], body.questions);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return json(res, 200, { ok: true });
    }
    if (sessionMatch && req.method === "DELETE") {
      const files = rows(db.prepare("SELECT stored_name FROM attachments WHERE session_id=?"), sessionMatch[1]);
      const result = db.prepare("DELETE FROM sessions WHERE id=?").run(sessionMatch[1]);
      files.forEach((file) => { const target = path.join(ATTACHMENTS_DIR, file.stored_name); if (existsSync(target)) unlinkSync(target); });
      return json(res, result.changes ? 200 : 404, { ok: Boolean(result.changes) });
    }

    if (req.method === "POST" && pathname === "/api/attachments") {
      const body = await readJson(req);
      if (!body.session_id || !body.name || !body.data) return json(res, 400, { error: "附件信息不完整" });
      const buffer = Buffer.from(body.data, "base64");
      if (buffer.length > 10 * 1024 * 1024) return json(res, 400, { error: "单个附件不能超过 10MB" });
      const id = randomUUID();
      const storedName = `${id}-${safeAttachmentName(body.name)}`;
      writeFileSync(path.join(ATTACHMENTS_DIR, storedName), buffer, { flag: "wx" });
      db.prepare("INSERT INTO attachments (id,session_id,original_name,stored_name,mime_type,size,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, body.session_id, path.basename(body.name), storedName, clean(body.type, "application/octet-stream"), buffer.length, now());
      return json(res, 201, { id });
    }
    const attachmentMatch = pathname.match(/^\/api\/attachments\/([^/]+)$/);
    if (attachmentMatch && req.method === "GET") {
      const item = db.prepare("SELECT * FROM attachments WHERE id=?").get(attachmentMatch[1]);
      if (!item) return json(res, 404, { error: "附件不存在" });
      const target = path.join(ATTACHMENTS_DIR, item.stored_name);
      res.writeHead(200, { "Content-Type": item.mime_type, "Content-Length": item.size, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(item.original_name)}` });
      return res.end(readFileSync(target));
    }
    if (attachmentMatch && req.method === "DELETE") {
      const item = db.prepare("SELECT * FROM attachments WHERE id=?").get(attachmentMatch[1]);
      if (!item) return json(res, 404, { error: "附件不存在" });
      db.prepare("DELETE FROM attachments WHERE id=?").run(item.id);
      const target = path.join(ATTACHMENTS_DIR, item.stored_name);
      if (existsSync(target)) unlinkSync(target);
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && pathname === "/api/resumes") {
      const body = await readJson(req);
      if (!clean(body.title) || !body.name || !body.data) return json(res, 400, { error: "请填写简历名称并选择文件" });
      const buffer = Buffer.from(body.data, "base64");
      if (buffer.length > 20 * 1024 * 1024) return json(res, 400, { error: "单份简历不能超过 20MB" });
      const id = randomUUID();
      const storedName = `${id}-${safeAttachmentName(body.name)}`;
      writeFileSync(path.join(RESUMES_DIR, storedName), buffer, { flag: "wx" });
      const stamp = now();
      db.prepare("INSERT INTO resumes (id,title,version,target_role,notes,original_name,stored_name,mime_type,size,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, clean(body.title), clean(body.version), clean(body.target_role), clean(body.notes), path.basename(body.name), storedName, clean(body.type, "application/octet-stream"), buffer.length, stamp, stamp);
      return json(res, 201, { id });
    }
    const resumeMatch = pathname.match(/^\/api\/resumes\/([^/]+)$/);
    if (resumeMatch && req.method === "GET") {
      const item = db.prepare("SELECT * FROM resumes WHERE id=?").get(resumeMatch[1]);
      if (!item) return json(res, 404, { error: "简历不存在" });
      const target = path.join(RESUMES_DIR, item.stored_name);
      res.writeHead(200, { "Content-Type": item.mime_type, "Content-Length": item.size, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(item.original_name)}` });
      return res.end(readFileSync(target));
    }
    if (resumeMatch && req.method === "DELETE") {
      const item = db.prepare("SELECT * FROM resumes WHERE id=?").get(resumeMatch[1]);
      if (!item) return json(res, 404, { error: "简历不存在" });
      db.prepare("DELETE FROM resumes WHERE id=?").run(item.id);
      const target = path.join(RESUMES_DIR, item.stored_name);
      if (existsSync(target)) unlinkSync(target);
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && pathname === "/api/schedules") {
      const body = await readJson(req);
      if (!clean(body.title) || !clean(body.scheduled_at)) return json(res, 400, { error: "日程名称和时间不能为空" });
      const id = randomUUID();
      const stamp = now();
      db.prepare(`INSERT INTO schedule_events (id,${scheduleColumns.join(",")},created_at,updated_at) VALUES (${["?", ...scheduleColumns.map(() => "?"), "?", "?"].join(",")})`)
        .run(id, body.application_id ? clean(body.application_id) : null, clean(body.title), clean(body.event_type, "其他"), clean(body.scheduled_at), clean(body.location), clean(body.reminder, "提前1天"), clean(body.notes), body.completed ? 1 : 0, stamp, stamp);
      return json(res, 201, { id });
    }
    const scheduleMatch = pathname.match(/^\/api\/schedules\/([^/]+)$/);
    if (scheduleMatch && req.method === "PATCH") {
      const body = await readJson(req);
      const sets = scheduleColumns.filter((key) => Object.hasOwn(body, key));
      if (!sets.length) return json(res, 400, { error: "没有可更新的字段" });
      const values = sets.map((key) => key === "application_id" ? (body[key] ? clean(body[key]) : null) : key === "completed" ? (body[key] ? 1 : 0) : clean(body[key]));
      db.prepare(`UPDATE schedule_events SET ${sets.map((key) => `${key}=?`).join(",")},updated_at=? WHERE id=?`).run(...values, now(), scheduleMatch[1]);
      return json(res, 200, { ok: true });
    }
    if (scheduleMatch && req.method === "DELETE") {
      const result = db.prepare("DELETE FROM schedule_events WHERE id=?").run(scheduleMatch[1]);
      return json(res, result.changes ? 200 : 404, { ok: Boolean(result.changes) });
    }

    if (req.method === "POST" && pathname === "/api/backup") {
      const filename = `autumn-recruitment-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
      const target = path.join(BACKUPS_DIR, filename);
      db.prepare("VACUUM INTO ?").run(target);
      return json(res, 201, { ok: true, path: target });
    }
    if (req.method === "GET" && pathname === "/api/export") {
      const payload = {
        version: 1,
        exported_at: now(),
        applications: rows(db.prepare("SELECT * FROM applications ORDER BY created_at")),
        sessions: rows(db.prepare("SELECT * FROM sessions ORDER BY created_at")),
        questions: rows(db.prepare("SELECT * FROM questions ORDER BY session_id, sort_order")),
        resumes: rows(db.prepare("SELECT id,title,version,target_role,notes,original_name,mime_type,size,created_at,updated_at FROM resumes ORDER BY created_at")),
        schedules: rows(db.prepare("SELECT * FROM schedule_events ORDER BY created_at")),
      };
      return json(res, 200, payload, { "Content-Disposition": `attachment; filename="autumn-recruitment-${new Date().toISOString().slice(0, 10)}.json"` });
    }
    if (req.method === "POST" && pathname === "/api/import") {
      const body = await readJson(req);
      if (!Array.isArray(body.applications) || !Array.isArray(body.sessions)) return json(res, 400, { error: "不是有效的秋招手账备份" });
      db.exec("BEGIN");
      try {
        const insertApp = db.prepare("INSERT OR REPLACE INTO applications (id," + applicationStorageColumns.join(",") + ",created_at,updated_at) VALUES (" + ["?", ...applicationStorageColumns.map(() => "?"), "?", "?"].join(",") + ")");
        body.applications.forEach((item) => insertApp.run(item.id || randomUUID(), ...applicationStorageColumns.map((key) => key === "rejection_stage" ? (item.status === "拒绝" && rejectionStages.has(clean(item[key])) ? clean(item[key]) : "") : key === "priority" ? clean(item[key], "中") : clean(item[key])), item.created_at || now(), item.updated_at || now()));
        const insertSession = db.prepare(`INSERT OR REPLACE INTO sessions (id,${sessionColumns.join(",")},created_at,updated_at) VALUES (${["?", ...sessionColumns.map(() => "?"), "?", "?"].join(",")})`);
        body.sessions.forEach((item) => insertSession.run(item.id || randomUUID(), ...sessionColumns.map((key) => ["duration", "rating"].includes(key) ? Number(item[key] || 0) : clean(item[key])), item.created_at || now(), item.updated_at || now()));
        const insertQuestion = db.prepare("INSERT OR REPLACE INTO questions (id,session_id,content,answer,reference_answer,category,needs_review,sort_order) VALUES (?,?,?,?,?,?,?,?)");
        (body.questions || []).forEach((item, index) => insertQuestion.run(item.id || randomUUID(), item.session_id, clean(item.content), clean(item.answer), clean(item.reference_answer), clean(item.category), item.needs_review ? 1 : 0, Number(item.sort_order ?? index)));
        const insertSchedule = db.prepare(`INSERT OR REPLACE INTO schedule_events (id,${scheduleColumns.join(",")},created_at,updated_at) VALUES (${["?", ...scheduleColumns.map(() => "?"), "?", "?"].join(",")})`);
        (body.schedules || []).forEach((item) => insertSchedule.run(item.id || randomUUID(), item.application_id || null, clean(item.title), clean(item.event_type, "其他"), clean(item.scheduled_at), clean(item.location), clean(item.reminder, "提前1天"), clean(item.notes), item.completed ? 1 : 0, item.created_at || now(), item.updated_at || now()));
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: "接口不存在" });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error instanceof Error ? error.message : "服务器错误" });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Autumn recruitment data service: http://localhost:${PORT}`));

function shutdown() { db.close(); server.close(() => process.exit(0)); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
