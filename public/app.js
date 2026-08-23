// 乔本·数果 AI 工作台 — 前端 SPA
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const MODULES = [
  { id: "overview", ic: "🏠", label: "概览", group: "核心" },
  { id: "planexec", ic: "🛰️", label: "计划与执行进度", group: "核心" },
  { id: "proposals", ic: "📄", label: "方案（AI写/改）", group: "核心" },
  { id: "feedback", ic: "📈", label: "数据反馈", group: "业务" },
  { id: "customers", ic: "👥", label: "客户管理", group: "业务" },
  { id: "media", ic: "🎬", label: "媒体库", group: "业务" },
  { id: "team", ic: "🤝", label: "团队", group: "协作" },
  { id: "collab", ic: "🧩", label: "协作与分工", group: "协作" },
  { id: "resources", ic: "🧰", label: "专家与工具", group: "协作" },
  { id: "aidesk", ic: "🤖", label: "AI 任务台", group: "智能" },
  { id: "ideas", ic: "💡", label: "想法库", group: "智能" },
  { id: "docs", ic: "📚", label: "学习库", group: "智能" },
  { id: "activity", ic: "🕘", label: "动态", group: "智能" },
];

const state = {
  db: { members: [], plans: [], tasks: [], proposals: [], feedback: [], customers: [], experts: [], tools: [], aiTasks: [], docs: [], events: [], followups: [], reports: [], media: [], messages: [], badges: [], drafts: [] },
  user: "m_beau",
  query: "",
  route: "overview",
  token: localStorage.getItem("qb_token") || "",
  authUser: localStorage.getItem("qb_user") || "",
  role: localStorage.getItem("qb_role") || "",
  canEdit: ["editor", "admin"].includes((localStorage.getItem("qb_role") || "")),
  inbox: [], inboxUnread: 0,
};
const COLS = ["members", "plans", "tasks", "proposals", "feedback", "customers", "experts", "tools", "aiTasks", "docs", "events", "followups", "reports", "media", "messages", "badges", "chatRooms", "drafts"];
const TASK_CATS = ["产品规划", "技术开发", "市场招商", "门店运营", "内容生产", "培训考核", "合规风控", "客户服务"];
let taskCatTab = "全部";
window.setTaskCat = (c) => { taskCatTab = c; render(); };
const MEDIA_KINDS = ["图文文章", "视频", "图片海报", "执行文档", "活动方案", "案例图文", "知识"];
const MEDIA_ICON = { 图文文章: "📝", 视频: "🎬", 图片海报: "🖼️", 执行文档: "📋", 活动方案: "📅", 案例图文: "📸", 知识: "💡" };
const MEDIA_REGIONS = ["全部区域", "通用", "华南", "华东", "华北", "西南", "全国"];
let mediaRegionTab = "全部区域";
window.setMediaRegion = (r) => { mediaRegionTab = r; render(); };

// ---------- 聊天系统 ----------
let chatRoom = "group"; // 'group' | 'dm_{id}_{id}' | 'grp_{ts}' 自定义群
let chatRooms = [];
function buildChatRooms() {
  const others = state.db.members.filter(m => m.id !== state.user);
  const custom = (state.db.chatRooms || []).filter(g => (g.members || []).includes(state.user));
  chatRooms = [
    { id: "group", name: "📢 项目总群", icon: "👥" },
    ...custom.map(g => ({ id: g.id, name: (g.emoji || "👥") + " " + g.name, icon: g.emoji || "👥", custom: true, ownerId: g.createdBy, members: g.members })),
    ...others.map(m => ({ id: "dm_" + [state.user, m.id].sort().join("_"), name: m.name, icon: "💬", targetId: m.id }))
  ];
}
function getChatMessages() {
  return (state.db.messages || []).filter(msg => (msg.roomId || "group") === chatRoom).sort((a, b) => a.ts - b.ts);
}
// 消息文本中的 @任务【标题】(id) 渲染成可点击卡片（点开即可编辑 → 任务分享协作）
function renderChatText(text) {
  return esc(text).replace(/@任务【([^】]*)】\(([\w-]+)\)/g, (full, title, tid) => {
    const t = (state.db.tasks || []).find(x => x.id === tid);
    const label = t ? t.title : title;
    return `<span class="chat-task-ref" onclick="event.stopPropagation();openTaskForm('${tid}')" title="点击打开并编辑该任务">📌 ${label}</span>`;
  });
}
window.sendChat = async () => {
  const el = $("#chatInput"); if (!el) return;
  const text = (el.value || "").trim(); if (!text) return;
  const msg = { id: "msg_" + Date.now(), roomId: chatRoom, from: state.user, text, ts: Date.now() };
  try {
    await api("POST", "/messages", msg);
    state.db.messages.push(msg);
    el.value = "";
    renderChatMessages();
    broadcast({ type: "mutation", col: "messages", action: "create", data: msg });
  } catch(e) { toast("发送失败：" + e.message); }
};
window.renderChatMessages = () => {
  const box = $("#chatMsgBox"); if (!box) return;
  const msgs = getChatMessages();
  if (!msgs.length) { box.innerHTML = '<div class="muted" style="text-align:center;padding:30px">暂无消息，开始对话吧 🎉</div>'; return; }
  box.innerHTML = msgs.map(m => {
    const isSelf = m.from === state.user;
    return `<div class="chat-bubble ${isSelf ? 'self' : 'other'}">
      <div>${renderChatText(m.text)}</div>
      <div class="meta">${mName(m.from)} · ${timeAgo(m.ts)}</div>
    </div>`;
  }).join("");
  box.scrollTop = 999999;
};
window.switchChatRoom = (id) => { chatRoom = id; render(); };
// ---------- 拉小组群 ----------
window.openGroupForm = () => {
  const others = state.db.members.filter(m => m.id !== state.user);
  openModal("拉一个小组群", `
    <div class="muted" style="margin-bottom:10px">选择成员组建小组，群内消息只对成员可见，实时同步；任务可通过 📌 引用共享编辑。</div>
    <div class="field"><label>群名称</label><input id="grpName" class="ipt" placeholder="如：招商专项组" /></div>
    <div class="field"><label>群成员（多选）</label>
      ${others.map(m => `<label class="chk-row"><input type="checkbox" class="grp-chk" value="${m.id}"> <img src='mascot-head.png' class='mascot-xs'> ${esc(m.name)} <span class="muted" style="font-size:12px">${esc(m.role)}</span></label>`).join("")}
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn btn-primary" id="grpGo">👥 创建群聊</button></div>`);
  $("#grpGo").onclick = async () => {
    const name = ($("#grpName").value || "").trim();
    if (!name) return toast("请填写群名称");
    const members = [...$$(".grp-chk:checked")].map(x => x.value);
    if (!members.length) return toast("请至少选择一名成员");
    const g = { id: "grp_" + Date.now(), name, emoji: "👥", members: [...members, state.user], createdBy: state.user, createdAt: Date.now() };
    try {
      await api("POST", "/chatRooms", g);
      state.db.chatRooms = state.db.chatRooms || [];
      state.db.chatRooms.push(g);
      chatRoom = g.id;
      closeModal(); render();
      toast("群「" + name + "」已创建，去聊天吧");
    } catch (e) { toast("创建失败：" + e.message); }
  };
};
window.dissolveGroup = async (gid) => {
  const g = (state.db.chatRooms || []).find(x => x.id === gid);
  if (!g) return;
  if (g.createdBy !== state.user && state.role !== "admin") return toast("只有群主或管理员可解散群");
  if (!confirm("确定解散群「" + g.name + "」？群消息将保留但入口消失。")) return;
  try {
    await api("DELETE", "/chatRooms/" + gid);
    state.db.chatRooms = state.db.chatRooms.filter(x => x.id !== gid);
    if (chatRoom === gid) chatRoom = "group";
    render();
    toast("群已解散");
  } catch (e) { toast("解散失败：" + e.message); }
};
window.chatInsertTask = () => {
  const el = $("#chatInput"); if (!el) return;
  const tasks = state.db.tasks.filter(t => t.status !== "done").slice(0, 8);
  openModal("引用任务到聊天", `<div class="muted" style="margin-bottom:8px">选择一个任务插入到消息中（@任务）</div>
    <div id="chatTaskList">${tasks.map(t => `<div class="chat-task-item" data-tid="${t.id}" style='padding:8px;border:1px solid var(--line);border-radius:8px;margin:6px 0;cursor:pointer'><b>${esc(t.title)}</b><div class='muted'>${esc(t.category)} · ${ownerBadge(t.ownerId)}</div></div>`).join("") || "<div class='muted'>暂无进行中的任务</div>"}</div>`);
  setTimeout(() => {
    $$("#chatTaskList .chat-task-item").forEach(div => {
      div.onclick = () => { chatDoInsertTask(div.dataset.tid); };
    });
  }, 50);
};
window.chatDoInsertTask = (tid) => {
  const t = state.db.tasks.find(x => x.id === tid); if (!t) return;
  const el = $("#chatInput");
  if (el) el.value += ` @任务【${t.title}】(${tid}) `;
  closeModal();
};
window.chatAIAssist = () => {
  const el = $("#chatInput"); if (!el) return;
  const id = "_chat_" + Date.now();
  const ctxId = "chatAI_" + id;
  _aiCfgs[id] = { kind: "generic", targetField: "_chatDummy", hint: "让 AI 帮你生成一条专业消息内容。" };
  $("#aiModalTitle").textContent = "🤖 AI 协助写消息";
  $("#aiModalBody").innerHTML = `
    <div class="muted" style="margin-bottom:8px">描述你想发的消息内容，AI 将基于乔本·数果业务知识生成草稿。</div>
    <div class="field"><label>给 AI 的指令</label><textarea id="aiPrompt" placeholder="例如：写一条提醒团队本周重点的消息…" style="min-height:100px"></textarea></div>
    ${attWidgetHTML(ctxId, { hint: "可上传参考截图/文档" })}
    <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn" type="button" onclick="document.getElementById('aiModal').classList.add('hidden')">取消</button><button class="btn btn-primary" id="aiGo">🤖 生成并填入</button></div>`;
  $("#aiModal").classList.remove("hidden");
  const go = $("#aiGo");
  go.onclick = async () => {
    const prompt = $("#aiPrompt").value.trim(); if (!prompt) return toast("请填写指令");
    go.disabled = true; go.textContent = "生成中…";
    try {
      const atts = attPayload(ctxId);
      const r = await api("POST", "/ai/generate", { kind: "generic", prompt, attachments: atts.map(a => a.id) });
      el.value = r.result || "";
      $("#aiModal").classList.add("hidden");
      toast("AI 已生成消息草稿，可编辑后发送");
    } catch(e) { toast("失败：" + e.message); }
    finally { go.disabled = false; go.textContent = "🤖 生成并填入"; }
  };
};

// ---------- API ----------
async function api(method, path, body) {
  // 写操作：非编辑角色在客户端先拦截；但计划/任务的 owner 与协助成员可在其参与范围内写入（服务端也会校验）
  const isWrite = ["POST", "PUT", "DELETE", "PATCH"].includes(method);
  if (isWrite && !state.canEdit && !itemLevelWriteAllowed(method, path, body)) {
    toast("无修改权限：该计划/任务仅创建者或协助成员可编辑，其他数据需编辑权限");
    throw new Error("read-only");
  }
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers["Authorization"] = "Bearer " + state.token;
  const res = await fetch("/api" + path, {
    method, headers,
    body: body ? JSON.stringify({ ...body, _actor: state.user }) : undefined,
  });
  if (res.status === 401) {
    localStorage.removeItem("qb_token"); localStorage.removeItem("qb_user"); localStorage.removeItem("qb_role");
    state.token = ""; state.authUser = ""; state.role = ""; state.canEdit = false;
    showLogin("登录已过期，请重新登录");
    throw new Error("unauthorized");
  }
  if (res.status === 403) {
    toast("无修改权限：仅协作者（编辑）名单内成员可修改数据");
    throw new Error(await res.text());
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function loadAll() {
  const inbox = await api("GET", "/inbox").catch(() => ({ list: [], unread: 0 }));
  state.inbox = inbox.list || []; state.inboxUnread = inbox.unread || 0;
  await Promise.all(COLS.map(async c => { state.db[c] = await api("GET", `/${c}`); }));
  renderAll();
}

// 渲染与鉴权解耦：渲染出错只提示，绝不再弹回登录框（否则会把已登录用户踢回登录层）
function renderAll() {
  try {
    renderNav(); renderUserSwitch(); render(); renderAuthBadge();
  } catch (e) {
    console.error("渲染出错：", e);
    toast("页面渲染出错：" + (e && e.message || e));
  }
}

// 仅在真正鉴权失效（token 已被清空）时才弹登录框；其它加载/渲染错误只提示
function onLoadFail(err) {
  if (!state.token) showLogin("登录已过期，请重新登录");
  else { console.error("加载失败：", err); toast("加载失败，请刷新重试：" + (err && err.message || err)); }
}

// ---------- 工具 ----------
const mName = (id) => (state.db.members.find(m => m.id === id) || {}).name || "—";
const mColor = (id) => (state.db.members.find(m => m.id === id) || {}).color || "#888";
const cName = (id) => (state.db.customers.find(c => c.id === id) || {}).name || "—";
const tName = (id) => (state.db.tasks.find(t => t.id === id) || {}).title || "—";
const statusChip = (s) => ({ done: "green", doing: "orange", todo: "brand", 待处理: "brand", 处理中: "orange", 已完成: "green" }[s] || "");
const matches = (item, q) => {
  if (!q) return true;
  const hay = [item.title, item.name, item.content, item.body, item.desc, item.note, item.text, item.metric, item.domain, item.category, item.stage, item.tags?.join?.(" ")]
    .filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
};

// 计划级权限：计划创建者 / 被邀请协助的成员，可编辑该计划及其下任务（即使全局只读）
function canEditPlan(p) {
  if (!p) return false;
  return p.ownerId === state.user || (p.collaborators || []).includes(state.user);
}
function canEditTask(t) {
  if (!t) return false;
  if (t.ownerId === state.user) return true;
  const p = (state.db.plans || []).find(x => x.id === t.planId);
  return canEditPlan(p);
}
function parseColId(path) {
  const m = String(path || "").match(/^\/?([\w-]+)\/?([^/]+)?/);
  return m ? { col: m[1], id: m[2] } : { col: "", id: "" };
}
// 写操作放行：计划/任务允许 owner / collaborators 在其参与范围内写入（服务端对 plans/tasks 不按角色拦截）
function itemLevelWriteAllowed(method, path, body) {
  const { col, id } = parseColId(path);
  // 聊天是基础协作能力：发消息 / 建群对所有登录成员开放
  if (col === "messages") return true;
  // 想法库草稿是个人空间：全体登录成员可写（服务端 draftWrite 白名单同样放行）
  if (col === "drafts") return true;
  if (col === "chatRooms") {
    if (method === "POST") return true; // 拉群
    const g = (state.db.chatRooms || []).find(x => x.id === id);
    return !!(g && (g.createdBy === state.user || state.role === "admin")); // 解散：群主/管理员
  }
  if (col === "plans") {
    if (method === "POST") return true; // 创建者自动成为 owner
    return canEditPlan((state.db.plans || []).find(x => x.id === id));
  }
  if (col === "tasks") {
    if (method === "POST") return canEditPlan((state.db.plans || []).find(x => x.id === (body && body.planId)));
    return canEditTask((state.db.tasks || []).find(x => x.id === id));
  }
  return false;
}

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.add("hidden"), 2200);
}

// ---------- 模块跳转（修复 goto 死链） ----------
window.goto = function(mod) {
  if (!mod) return;
  state.route = mod;
  location.hash = mod;
  renderNav();
  render();
};
window.togglePw = function(inputId, btn) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.type = el.type === "password" ? "text" : "password";
  if (btn) btn.textContent = el.type === "password" ? "👁" : "🙈";
};

// ---------- Chart.js 图表注册表 ----------
const _charts = {};
function destroyCharts() {
  Object.values(_charts).forEach(c => { try { c.destroy(); } catch(e) {} });
  for (const k in _charts) delete _charts[k];
}
function makeChart(canvasId, type, data, options) {
  if (typeof Chart === "undefined") return null;
  const el = document.getElementById(canvasId);
  if (!el) return null;
  const ctx = el.getContext("2d");
  const c = new Chart(ctx, { type, data, options: { responsive: true, maintainAspectRatio: false, ...options } });
  _charts[canvasId] = c;
  return c;
}
// 科技感配色
const CHART_COLORS = {
  brand: "#7c5cff", brand2: "#5b8def", green: "#1e9e6a", orange: "#e8833a", red: "#e0533d",
  palette: ["#7c5cff", "#5b8def", "#1e9e6a", "#e8833a", "#e0533d", "#9aa0b0", "#6c5ce7", "#0984e3"],
  grid: "rgba(124,92,255,.08)",
};
// 在 render() 前销毁旧图，避免 canvas 复用报错
const _origRender = render;
render = function() { destroyCharts(); _origRender(); };

// ---------- 弹窗表单 ----------
function openModal(title, bodyHTML, opts = {}) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = bodyHTML;
  const card = $("#modal .modal-card");
  if (card) card.classList.toggle("modal-wide", !!opts.wide);
  $("#modal").classList.remove("hidden");
  applyReadonly();
}
function closeModal() { $("#modal").classList.add("hidden"); }
$("#modalClose").onclick = closeModal;

// 通用删除（所有模块的「删除/移除/删」按钮统一走这里）
//  - 成员移除：仅管理员
//  - 其它集合：需 editor/admin（客户端先拦，服务端硬拦）
window.del = async (col, id) => {
  if (!id) return;
  const label = { members: "成员", plans: "计划", proposals: "方案", tasks: "任务", feedback: "反馈", customers: "客户", media: "素材", experts: "专家", tools: "工具", aiTasks: "AI任务", docs: "课程" }[col] || "条目";
  if (col === "members" && state.role !== "admin") { toast("仅管理员可移除成员"); return; }
  if (!state.canEdit) { toast("无修改权限：请先申请并获得编辑权限"); return; }
  if (!confirm(`确定删除该${label}？此操作不可撤销。`)) return;
  try {
    await api("DELETE", `/${col}/${id}`);
    toast(`已删除${label}`);
    render();
  } catch (e) { toast("删除失败：" + (e.message || e)); }
};

// 通用字段表单：fields=[{key,label,type:'text'|'textarea'|'select'|'date'|'number'|'tags',options:[{v,l}],placeholder}]
function formHTML(fields, values = {}) {
  return fields.map(f => {
    const v = values[f.key] ?? "";
    let inner = "";
    if (f.type === "textarea") inner = `<textarea name="${f.key}" placeholder="${f.placeholder || ""}">${esc(v)}</textarea>`;
    else if (f.type === "select") inner = `<select name="${f.key}">${(f.options || []).map(o => `<option value="${o.v}" ${o.v == v ? "selected" : ""}>${o.l}</option>`).join("")}</select>`;
    else if (f.type === "tags") inner = `<input name="${f.key}" value="${esc(Array.isArray(v) ? v.join(", ") : v)}" placeholder="逗号分隔，如：IBS, 高管" />`;
    else inner = `<input name="${f.key}" type="${f.type || "text"}" value="${esc(v)}" placeholder="${f.placeholder || ""}" />`;
    return `<div class="field"><label>${f.label}</label>${inner}</div>`;
  }).join("") + `<div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-primary" id="formSubmit">保存</button></div>`;
}
function readForm() {
  const fd = {};
  $$("#modalBody [name]").forEach(el => {
    fd[el.name] = el.value.trim();
    if (el.name.endsWith("tags")) fd[el.name] = fd[el.name] ? fd[el.name].split(",").map(s => s.trim()).filter(Boolean) : [];
  });
  return fd;
}

// ---------- AI 协助（所有输入型功能通用） ----------
let _aiSeq = 0; const _aiCfgs = {};
// cfg: { kind, targetField, titleField?, hint?, promptPH? }
function aiBtn(kind, targetField, opts = {}) {
  const id = "ai" + (_aiSeq++);
  _aiCfgs[id] = { kind, targetField, ...opts };
  const label = opts.label || "🤖 AI 协助填写";
  return `<div class="ai-assist-row"><button class="btn btn-sm" type="button" onclick="openAIPrompt('${id}')">${label}</button><span class="muted" style="font-size:12px">AI 基于乔本·数果业务知识生成草稿，填入后可改</span></div>`;
}
function setFormVal(name, val) {
  const el = $(`#modalBody [name='${name}']`);
  if (el) el.value = val;
}
window.openAIPrompt = async (id) => {
  const cfg = _aiCfgs[id]; if (!cfg) return;
  const ctxId = "ai_" + id;
  $("#aiModalTitle").textContent = "🤖 AI 协助 · " + (cfg.label || "生成草稿");
  $("#aiModalBody").innerHTML = `
    <div class="muted" style="margin-bottom:8px">${esc(cfg.hint || "描述你的需求，AI 将基于乔本·数果业务知识生成草稿并填入表单。")}</div>
    ${cfg.titleField ? `<div class="field"><label>${esc(cfg.titleField)}</label><input id="aiTitle" placeholder="${esc(cfg.titlePH || "")}" /></div>` : ""}
    <div class="field"><label>给 AI 的指令</label><textarea id="aiPrompt" placeholder="${esc(cfg.promptPH || "例如：围绕肠道菌群基础知识，生成一门 20 分钟的代理商培训课程")}" style="min-height:110px"></textarea></div>
    ${attWidgetHTML(ctxId, { hint: "可上传参考文档/图片（AI 将提取文字并作为上下文参考）" })}
    <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn" type="button" onclick="document.getElementById('aiModal').classList.add('hidden')">取消</button><button class="btn btn-primary" id="aiGo">🤖 生成并填入</button></div>`;
  $("#aiModal").classList.remove("hidden");
  const go = $("#aiGo");
  go.onclick = async () => {
    const prompt = $("#aiPrompt").value.trim();
    if (!prompt) return toast("请填写指令");
    const title = cfg.titleField ? ($("#aiTitle").value.trim()) : "";
    go.disabled = true; go.textContent = "生成中… 🤖";
    try {
      const atts = attPayload(ctxId);
      const r = await api("POST", "/ai/generate", { kind: cfg.kind, prompt, title, linkedType: cfg.linkedType || "", attachments: atts.map(a => a.id) });
      if (cfg.titleField && r.title) setFormVal(cfg.titleField, r.title);
      setFormVal(cfg.targetField, r.result);
      if (cfg.kind === "doc") {
        if (r.duration != null) setFormVal("duration", r.duration);
        if (r.quiz) setFormVal("quiz", JSON.stringify(r.quiz, null, 0));
      }
      $("#aiModal").classList.add("hidden");
      toast("🤖 AI 已生成并填入表单，请检查后保存");
    } catch (e) { toast("生成失败：" + (e.message || "")); }
    finally { go.disabled = false; go.textContent = "🤖 生成并填入"; }
  };
};

// ---------- AI 多模态输入附件（通用组件：上传 / 解析 / 芯片） ----------
const _att = {}; // ctxId -> { id, name, size, kind, status, chars, text, error }[]
let _attSeq = 0;
function attWidgetHTML(ctxId, opts = {}) {
  _att[ctxId] = [];
  const acc = opts.accept || "image/*,.pdf,.doc,.docx,.rtf,.txt,.md,.csv,.json,.html,.xlsx,.pptx";
  const hid = "attFile_" + ctxId + "_" + (_attSeq++);
  return `<div class="att-zone" id="attZone_${ctxId}" data-ctx="${ctxId}">
    <div class="att-bar">
      <button class="btn btn-sm" type="button" onclick="attPick('${ctxId}','${hid}')">📎 添加图片/文档</button>
      <span class="muted" style="font-size:12px">${esc(opts.hint || "支持图片 OCR、PDF/Word/Excel/PPT/文本解析，可拖拽或粘贴")}</span>
    </div>
    <div class="att-chips" id="attChips_${ctxId}"></div>
    <input type="file" multiple accept="${acc}" id="${hid}" style="display:none" onchange="attFiles('${ctxId}', this.files); this.value=''">
  </div>`;
}
window.attPick = (ctxId, hid) => { const el = $(`#${hid}`); if (el) el.click(); };
window.attFiles = async (ctxId, files) => {
  for (const f of files) { await attUpload(ctxId, f); }
};
async function attUpload(ctxId, file) {
  if (!file) return;
  const id = "att_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(2, 6);
  const meta = { id, name: file.name, size: file.size, kind: "uploading", status: "上传中", chars: 0, text: "", error: "" };
  const arr = _att[ctxId] || (_att[ctxId] = []);
  arr.push(meta);
  attRender(ctxId);
  try {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/ai/upload", { method: "POST", headers: { Authorization: "Bearer " + (state.token || "") }, body: fd });
    if (!r.ok) { const j = await r.json().catch(() => ({})); meta.error = j.error || "上传失败"; meta.status = "失败"; meta.kind = "error"; attRender(ctxId); return; }
    const j = await r.json();
    meta.id = j.id; meta.kind = j.kind; meta.status = "解析中"; attRender(ctxId);
    const e = await fetch("/api/ai/extract", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (state.token || "") }, body: JSON.stringify({ ids: [j.id] }) });
    if (!e.ok) { meta.error = "解析失败"; meta.status = "失败"; meta.kind = "error"; attRender(ctxId); return; }
    const [er] = await e.json();
    if (er.error && !er.text) { meta.error = er.error || "未能提取文字"; meta.status = "失败"; meta.kind = "error"; }
    else { meta.text = er.text || ""; meta.status = "就绪"; meta.chars = er.chars || 0; }
    attRender(ctxId);
  } catch (ex) { meta.error = (ex && ex.message) || "上传异常"; meta.status = "失败"; meta.kind = "error"; attRender(ctxId); }
}
function attRender(ctxId) {
  const box = $(`#attChips_${ctxId}`); if (!box) return;
  const arr = _att[ctxId] || [];
  if (!arr.length) { box.innerHTML = ""; return; }
  box.innerHTML = arr.map((a, i) => {
    const icon = a.kind === "image" ? "🖼" : a.kind === "pdf" ? "📄" : a.kind === "doc" ? "📝" : a.kind === "sheet" ? "📊" : a.kind === "slides" ? "📽" : "📎";
    const badge = a.status === "就绪" ? `<span class="att-badge green">${a.chars}字</span>` : a.status === "解析中" ? `<span class="att-badge blue">解析中</span>` : a.status === "上传中" ? `<span class="att-badge blue">上传中</span>` : `<span class="att-badge red">${esc(a.error || "失败")}</span>`;
    return `<div class="att-chip ${a.status === '失败' ? 'att-err' : ''}">${icon} <span class="att-name">${esc(a.name)}</span>${badge}<button class="att-del" onclick="attRemove('${ctxId}', ${i})" title="移除">×</button></div>`;
  }).join("");
}
window.attRemove = (ctxId, idx) => { const arr = _att[ctxId]; if (!arr) return; arr.splice(idx, 1); attRender(ctxId); };
function attPayload(ctxId) { return (_att[ctxId] || []).filter(a => a.status === "就绪" && a.id).map(a => ({ id: a.id, name: a.name })); }
function attEnableDrop(ctxId, zoneSel) {
  const el = $(zoneSel); if (!el) return;
  el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("att-drag"); });
  el.addEventListener("dragleave", () => { el.classList.remove("att-drag"); });
  el.addEventListener("drop", e => { e.preventDefault(); el.classList.remove("att-drag"); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { attFiles(ctxId, e.dataTransfer.files); } });
}
function attEnablePaste(ctxId, taId) {
  const el = $(taId); if (!el) return;
  el.addEventListener("paste", e => {
    const items = e.clipboardData && e.clipboardData.items ? Array.from(e.clipboardData.items) : [];
    const files = items.filter(it => it.kind === "file").map(it => it.getAsFile()).filter(Boolean);
    if (files.length) attFiles(ctxId, files);
  });
}

// ---------- 导航 ----------
function renderNav() {
  const groups = [...new Set(MODULES.map(m => m.group))];
  let html = "";
  for (const g of groups) {
    html += `<div class="nav-group-head">${g}</div>`;
    for (const m of MODULES.filter(m => m.group === g)) {
      html += `<div class="nav-item ${state.route === m.id ? "active" : ""}" data-mod="${m.id}"><span class="ic">${m.ic}</span>${m.label}</div>`;
    }
  }
  $("#nav").innerHTML = html;
  $$("#nav .nav-item").forEach(n => n.onclick = () => { state.route = n.dataset.mod; location.hash = n.dataset.mod; renderNav(); render(); });
}
function renderUserSwitch() {
  $("#userSwitch").innerHTML = state.db.members.map(m => `<option value="${m.id}" ${m.id === state.user ? "selected" : ""}>${esc(m.name)}</option>`).join("");
  $("#userSwitch").onchange = e => { state.user = e.target.value; sendPresence(); toast("已切换为 " + mName(state.user)); };
}

// ---------- 路由 ----------
// 旧路由别名：合并前的 plans/progress 统一跳转到 planexec
const ROUTE_ALIAS = { plans: "planexec", progress: "planexec", plan: "planexec", exec: "planexec" };
function normalizeRoute(r) { r = (r || "overview").replace(/^\/+/, ""); return ROUTE_ALIAS[r] || r; }
location.onhashchange = () => {
  const raw = location.hash.slice(1) || "overview";
  const r = normalizeRoute(raw);
  if (r !== raw) location.hash = r; // 旧链接自动跳转到新路由
  state.route = r; renderNav(); render();
};
if (location.hash) state.route = normalizeRoute(location.hash.slice(1));

// ---------- 渲染主入口 ----------
function render() {
  const r = state.route;
  const main = $("#main");
  const fns = { overview: renderOverview, planexec: renderPlanExec, proposals: renderProposals, feedback: renderFeedback, customers: renderCustomers, media: renderMedia, team: renderTeam, collab: renderCollab, resources: renderResources, aidesk: renderAIDesk, ideas: renderIdeas, docs: renderDocs, activity: renderActivity };
  try {
    (fns[r] || renderOverview)(main);
  } catch (e) {
    console.error(`模块 ${r} 渲染出错：`, e);
    main.innerHTML = `<div class='empty' style='padding:40px'>
      <div style='font-size:40px;margin-bottom:10px'>⚠️</div>
      <b>「${esc(r)}」模块渲染出错</b>
      <div class='muted' style='margin-top:6px;word-break:break-all'>${esc(String(e && e.message || e))}</div>
      <button class='btn btn-primary' style='margin-top:12px' onclick='location.reload()'>刷新重试</button>
    </div>`;
  }
  applyReadonly();
}

// ---------- 各模块 ----------
function renderOverview(main) {
  const db = state.db;
  const customers = db.customers;
  const B = customers.filter(c => c.type === 'B');
  const C = customers.filter(c => c.type === 'C');
  const tiers = ['省代', '市代', '区代', '门店', '合伙人'];
  const tierCount = t => B.filter(c => c.tier === t).length;
  const tasks = db.tasks;
  const done = tasks.filter(t => t.status === 'done').length;
  const doing = tasks.filter(t => t.status === 'doing').length;
  const todo = tasks.filter(t => t.status === 'todo').length;
  const total = tasks.length || 1;
  const lv = l => customers.filter(c => c.level === l).length;
  const allDims = db.reports.flatMap(r => r.dimensions || []);
  const dimBad = allDims.filter(d => d.status && d.status !== '正常').length;
  const dimNormal = allDims.filter(d => d.status === '正常').length;
  const ring = (pct, c, label) => `<div style='width:104px;height:104px;border-radius:50%;background:conic-gradient(${c} ${pct}%, var(--line) 0);position:relative;flex:0 0 auto'>
    <div style='position:absolute;inset:17px;border-radius:50%;background:var(--panel);display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:700;font-size:18px'>${pct}%<span style='font-size:10px;font-weight:400;color:var(--ink2)'>${label}</span></div></div>`;
  const legend = (color, label, n) => `<div class='row' style='gap:6px;font-size:13px;margin:3px 0'><i style='width:11px;height:11px;border-radius:3px;background:${color};display:inline-block'></i>${label} <b>${n}</b></div>`;

  main.innerHTML = `
  <div class='page-head pex-head'><div><h2>🛰️ 全盘数据大盘</h2><div class='sub'>乔本·数果 AI 肠道健康管理 · 实时同步 · 多端数据互通</div></div>
    <button class='btn btn-primary' onclick="goto('aidesk')">🤖 发起 AI 任务</button></div>

  <div class='grid cols-6'>
    ${kpi('计划', db.plans.length, '🗺️', 'planexec')}
    ${kpi('进行中任务', doing, '⚙️', 'planexec')}
    ${kpi('已完成任务', done, '✅', 'planexec')}
    ${kpi('方案', db.proposals.length, '📄', 'proposals')}
    ${kpi('客户总数', customers.length, '👥', 'customers')}
    ${kpi('B端渠道', B.length, '🏢', 'customers')}
    ${kpi('C端用户', C.length, '🧍', 'customers')}
    ${kpi('随访记录', db.followups.length, '📞', 'customers')}
    ${kpi('检测报告', db.reports.length, '🧪', 'feedback')}
    ${kpi('待处理AI', db.aiTasks.filter(a => a.status !== '已完成').length, '🤖', 'aidesk')}
    ${kpi('专家', db.experts.length, '🎓', 'resources')}
    ${kpi('知识库', db.docs.length, '📚', 'docs')}
    ${kpi('媒体库', db.media.length, '🎬', 'media')}
  </div>

  <div class='grid cols-3' style='margin-top:16px'>
    <div class='card chart-card'><h3>📊 任务状态分布</h3><div class='chart-box'><canvas id='ovPieTasks'></canvas></div></div>
    <div class='card chart-card'><h3>📈 计划进度走势</h3><div class='chart-box'><canvas id='ovTrendPlans'></canvas></div></div>
    <div class='card chart-card'><h3>🔗 业务链路漏斗</h3><div class='chart-box'><canvas id='ovFunnel'></canvas></div></div>
  </div>

  <div class='grid cols-2' style='margin-top:16px'>
    <div class='card'><h3>🔗 业务链路：渠道 → 用户</h3>
      <div class='muted' style='font-size:12px;margin-bottom:10px'>B 端五级渠道逐级带来 C 端用户，统一管理路径。</div>
      ${tiers.map(t => `<div class='row' style='margin:9px 0;align-items:center'><div style='width:56px;font-size:13px;flex:0 0 auto'>${t}</div><div class='bar' style='flex:1'><i style='width:${total ? Math.round(tierCount(t) / total * 100) : 0}%'></i></div><div style='width:34px;text-align:right;font-weight:700;flex:0 0 auto'>${tierCount(t)}</div></div>`).join('')}
      <div class='row' style='margin:9px 0;align-items:center'><div style='width:56px;font-size:13px;flex:0 0 auto'>C端</div><div class='bar' style='flex:1'><i style='width:100%;background:var(--brand)'></i></div><div style='width:34px;text-align:right;font-weight:700;flex:0 0 auto'>${C.length}</div></div>
    </div>
    <div class='card'><h3>📊 客户价值分布</h3><div class='chart-box' style='margin-top:8px'><canvas id='ovPieCustomers'></canvas></div></div>
  </div>

  <div class='grid cols-2' style='margin-top:16px'>
    <div class='card'><h3>🗺️ 计划进度</h3>
      ${db.plans.map(p => `<div style='margin:11px 0'><div class='row' style='justify-content:space-between'><b style='font-size:13px'>${esc(p.title)}</b><span class='chip ${statusChip(p.status)}'>${p.progress}%</span></div><div class='bar'><i style='width:${p.progress}%'></i></div><div class='meta'>${mName(p.ownerId)} · ${p.status} · ${p.start}→${p.end}</div></div>`).join('') || "<div class='muted'>暂无计划</div>"}
    </div>
    <div class='card'><h3>🧪 菌群检测指标概览</h3>
      <div class='row' style='gap:20px;align-items:center;margin-bottom:12px'>
        ${ring(allDims.length ? Math.round(dimNormal / allDims.length * 100) : 0, 'var(--green)', '正常')}
        <div>${legend('var(--green)', '正常指标', dimNormal)}${legend('#e0533d', '异常指标', dimBad)}<div class='muted' style='font-size:12px'>覆盖 ${db.reports.length} 份报告 / ${allDims.length} 项指标</div></div>
      </div>
      <div>${[...new Set(allDims.map(d => d.name))].map(n => { const ds = allDims.filter(d => d.name === n); const bad = ds.filter(d => d.status !== '正常').length; return `<span class='chip ${bad ? 'red' : 'green'}' style='margin:3px'>${esc(n)} ${bad ? bad + '⚠' : ''}</span>`; }).join('') || "<span class='muted'>暂无报告</span>"}</div>
    </div>
  </div>

  <div class='card' style='margin-top:16px'><h3>📈 业务发展进度</h3>
    <div class='muted' style='font-size:12px;margin-bottom:10px'>按 5 大计划追踪业务里程碑与关键指标，数据全盘互通。</div>
    ${db.plans.map(p => {
      const ts = db.tasks.filter(t => t.planId === p.id);
      const done = ts.filter(t => t.status === 'done').length;
      const doing = ts.filter(t => t.status === 'doing').length;
      const total = ts.length || 1;
      const pctDone = Math.round(done / total * 100);
      // 关联指标
      const linkedFeedback = db.feedback.filter(f => ts.some(t => t.id === f.linkedTaskId));
      const linkedCustomers = db.customers.filter(c => c.stage === '干预中' || c.stage === '复购');
      const milestone = p.progress >= 80 ? '🏁 收尾阶段' : p.progress >= 50 ? '🚀 核心推进' : p.progress > 0 ? '📌 启动执行' : '⏳ 待启动';
      return `<div style='margin:12px 0;padding:12px;border:1px solid var(--line);border-radius:12px;background:#fafbff'>
        <div class='row' style='justify-content:space-between;align-items:center'>
          <b style='font-size:14px'>${esc(p.title)}</b>
          <span class='row' style='gap:6px'><span class='chip brand'>${milestone}</span><span class='chip ${statusChip(p.status)}'>${p.status}</span></span>
        </div>
        <div class='bar' style='margin-top:8px'><i style='width:${p.progress}%;background:${p.progress>=80?"var(--green)":p.progress>=50?"var(--brand)":"var(--orange)"}'></i></div>
        <div class='grid cols-4' style='margin-top:10px'>
          <div style='text-align:center'><div style='font-size:18px;font-weight:700;color:var(--brand)'>${p.progress}%</div><div class='muted' style='font-size:11px'>计划进度</div></div>
          <div style='text-align:center'><div style='font-size:18px;font-weight:700;color:var(--green)'>${done}/${total}</div><div class='muted' style='font-size:11px'>任务完成</div></div>
          <div style='text-align:center'><div style='font-size:18px;font-weight:700;color:var(--orange)'>${doing}</div><div class='muted' style='font-size:11px'>进行中</div></div>
          <div style='text-align:center'><div style='font-size:18px;font-weight:700;color:var(--ink2)'>${linkedFeedback.length}</div><div class='muted' style='font-size:11px'>关联反馈</div></div>
        </div>
        <div class='meta' style='margin-top:6px'>${mName(p.ownerId)} · ${p.start} → ${p.end} · <span class='linked' onclick="goto('planexec')">查看甘特图 →</span></div>
      </div>`;
    }).join('')}
  </div>

  <div class='card' style='margin-top:16px'><h3>🙋 待领取任务</h3>
    <div class='muted' style='font-size:12px;margin-bottom:8px'>以下任务暂未分配负责人，协作成员可一键领取。</div>
    <div class='grid cols-2'>${db.tasks.filter(t => !t.ownerId).map(t => `<div class='row' style='justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)'><div><b>${esc(t.title)}</b> ${({ 高: "<span class='chip red'>高</span>", 中: "<span class='chip orange'>中</span>", 低: "<span class='chip'>低</span>" }[t.priority] || "")}<div class='muted' style='font-size:12px'>计划：${esc((db.plans.find(p => p.id === t.planId) || {}).title || "—")} · 截止 ${t.due || "—"}</div></div><button class='btn btn-sm btn-primary' onclick='claimTask("${t.id}")'>领取</button></div>`).join('') || "<div class='muted'>🎉 所有任务都已认领</div>"}</div>
  </div>

  <div class='grid cols-2' style='margin-top:16px'>
    <div class='card'><h3>📞 近期随访</h3>${db.followups.slice(0, 6).map(f => `<div style='margin:8px 0;font-size:13px'><span class='chip brand'>${esc(f.type)}</span> ${esc(cName(f.customerId))} · ${mName(f.byMember)}<div class='muted'>${f.date} · ${esc(f.content)}</div></div>`).join('') || "<div class='muted'>暂无随访</div>"}</div>
    <div class='card'><h3>🕘 最近动态</h3>${db.events.slice(0, 8).map(e => `<div style='margin:7px 0;font-size:13px'><span class='chip brand'>${mName(e.actor)}</span> ${esc(e.text)} <span class='muted'>· ${timeAgo(e.ts)}</span></div>`).join('')}</div>
  </div>`;

  // 渲染 Chart.js 图表
  setTimeout(() => {
    // 1) 任务状态饼图
    makeChart("ovPieTasks", "doughnut", {
      labels: ["已完成", "进行中", "待启动"],
      datasets: [{ data: [done, doing, todo], backgroundColor: [CHART_COLORS.green, CHART_COLORS.brand, "#e7e9f0"], borderWidth: 0 }]
    }, { plugins: { legend: { position: "bottom" } }, cutout: "60%" });

    // 2) 计划进度走势线图
    const planLabels = db.plans.map(p => p.title.slice(0, 8));
    const planProgress = db.plans.map(p => p.progress || 0);
    const planTaskDone = db.plans.map(p => {
      const ts = db.tasks.filter(t => t.planId === p.id);
      return ts.length ? Math.round(ts.filter(t => t.status === "done").length / ts.length * 100) : 0;
    });
    makeChart("ovTrendPlans", "line", {
      labels: planLabels,
      datasets: [
        { label: "计划进度%", data: planProgress, borderColor: CHART_COLORS.brand, backgroundColor: "rgba(124,92,255,.1)", tension: .3, fill: true },
        { label: "任务完成%", data: planTaskDone, borderColor: CHART_COLORS.green, backgroundColor: "rgba(30,158,106,.08)", tension: .3, fill: true },
      ]
    }, { plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true, max: 100, grid: { color: CHART_COLORS.grid } } } });

    // 3) 业务链路漏斗
    const funnelStages = ["B端渠道", "门店", "C端用户", "检测报告", "复购/干预"];
    const funnelData = [B.length, B.filter(c => c.tier === "门店").length, C.length, db.reports.length, C.filter(c => c.stage === "复购" || c.stage === "干预中").length];
    makeChart("ovFunnel", "bar", {
      labels: funnelStages,
      datasets: [{ label: "数量", data: funnelData, backgroundColor: [CHART_COLORS.brand, CHART_COLORS.brand2, CHART_COLORS.green, CHART_COLORS.orange, CHART_COLORS.red], borderRadius: 6 }]
    }, { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: CHART_COLORS.grid } } } });

    // 4) 客户价值分布饼图
    makeChart("ovPieCustomers", "pie", {
      labels: ["A 级", "B 级", "C 级"],
      datasets: [{ data: [lv("A"), lv("B"), lv("C")], backgroundColor: [CHART_COLORS.brand, CHART_COLORS.orange, "#9aa0b0"], borderWidth: 0 }]
    }, { plugins: { legend: { position: "bottom" } } });
  }, 30);
}
function renderActivity(main) {
  const list = state.db.events || [];
  main.innerHTML = `<div class='page-head'><div><h2>🕘 动态</h2><div class='sub'>团队操作时间线，实时同步</div></div></div>
    <div class='card'>
      ${list.map(e => `<div class='row' style='justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)'>
        <div style='font-size:14px'><span class='chip brand'>${mName(e.actor)}</span> ${esc(e.text)}</div>
        <div class='muted' style='font-size:12px;white-space:nowrap'>${timeAgo(e.ts)}</div>
      </div>`).join('') || "<div class='muted'>暂无动态</div>"}
    </div>`;
}
function ownerBadge(oid) {
  if (!oid) return '<span class="chip red">⚠ 待指派责任人</span>';
  const m = state.db.members.find(x => x.id === oid);
  if (!m) return esc(oid);
  return `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:20px;height:20px;border-radius:50%;background:${m.color};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${esc(m.name[0])}</span>${esc(m.name)}</span>`;
}
function kpi(l, n, ic, link) { return `<div class="card kpi" ${link ? `onclick="goto('${link}')" style="cursor:pointer"` : ""}><div class="l">${ic} ${l}</div><div class="n">${n}</div></div>`; }
function timeAgo(ts) { const d = Math.floor((Date.now() - ts) / 1000); if (d < 60) return "刚刚"; if (d < 3600) return Math.floor(d / 60) + "分钟前"; if (d < 86400) return Math.floor(d / 3600) + "小时前"; return Math.floor(d / 86400) + "天前"; }

function renderPlans(main) {
  const list = state.db.plans.filter(p => matches(p, state.query));
  // 甘特图计算
  const allStarts = list.map(p => p.start).filter(Boolean);
  const allEnds = list.map(p => p.end).filter(Boolean);
  const ganttMin = allStarts.length ? new Date(Math.min(...allStarts.map(d => new Date(d)))) : new Date();
  const ganttMax = allEnds.length ? new Date(Math.max(...allEnds.map(d => new Date(d)))) : new Date(Date.now() + 90*86400000);
  const ganttRange = ganttMax - ganttMin || 1;
  const ganttPx = (dateStr) => { const d = new Date(dateStr); return ((d - ganttMin) / ganttRange * 100); };
  const monthTicks = (() => {
    const ms = []; let cur = new Date(ganttMin.getFullYear(), ganttMin.getMonth(), 1);
    while (cur <= ganttMax) { ms.push(cur.toLocaleDateString("zh-CN",{year:"numeric",month:"short"})); cur.setMonth(cur.getMonth()+1); }
    return ms;
  })();

  main.innerHTML = `<div class="page-head"><div><h2>计划</h2><div class="sub">分解目标，下挂任务，甘特图概览进度互通</div></div>
    <button class="btn btn-primary" onclick="openPlanForm()">＋ 新建计划</button></div>

    <!-- 甘特图 -->
    <div class="card" style="margin-bottom:16px"><h3>📊 甘特图概览</h3>
      <div class="gantt-wrap"><div class="gantt">
        ${list.map(p => {
          const left = ganttPx(p.start);
          const width = Math.max(ganttPx(p.end) - left, 3);
          return `<div class="gantt-row">
            <div class="gantt-label" title="${esc(p.title)}">${esc(p.title)}</div>
            <div class="gantt-bar-wrap">
              <div class="gantt-bar-bg"></div>
              <div class="gantt-bar" style="left:${left}%;width:${width}%;${p.progress>=80?'background:var(--green)':p.progress>=50?'':'background:var(--orange)'}"
                title="${esc(p.title)} · ${p.progress}% · ${p.status}" onclick="openPlanForm('${p.id}')">
                ${p.progress}%
              </div>
            </div>
          </div>`}).join("")}
        <div class="gantt-ticks">${monthTicks.map(m => `<div class="gantt-tick">${m}</div>`).join("")}</div>
      </div></div>
    </div>

    <div class="grid cols-2">${list.map(p => {
      const ts = state.db.tasks.filter(t => t.planId === p.id);
      const done = ts.filter(t => t.status === "done").length;
      return `<div class="card"><div class="row" style="justify-content:space-between"><h3>${esc(p.title)}</h3><span class="chip ${statusChip(p.status)}">${p.status}</span></div>
      <div class="muted">${esc(p.desc)}</div>
      <div class="bar"><i style="width:${p.progress}%"></i></div>
      <div class="meta">${p.ownerId ? "负责人 " + mName(p.ownerId) : '<span class="chip orange">待认领</span>'} · ${p.start}→${p.end} · 任务 ${done}/${ts.length} · 进度 ${p.progress}%</div>
      <div class="row" style="margin-top:10px">${!p.ownerId ? `<button class="btn btn-sm btn-primary" onclick="claimPlan('${p.id}')">🙋 认领该计划</button>` : ""}<button class="btn btn-sm" onclick="openPlanForm('${p.id}')">编辑</button>
      <button class="btn btn-sm" onclick="goto('planexec')">看任务</button>
      <button class="btn btn-sm btn-danger" onclick="del('plans','${p.id}')">删除</button></div></div>`;
    }).join("") || "<div class='empty'>无匹配计划</div>"}</div>`;
}
window.openPlanForm = (id) => {
  const p = id ? state.db.plans.find(x => x.id === id) : { ownerId: state.user, collaborators: [], status: "进行中", progress: 0 };
  openModal(id ? "编辑计划" : "新建计划", formHTML([
    { key: "title", label: "计划标题" }, { key: "desc", label: "描述", type: "textarea" },
    { key: "status", label: "状态", type: "select", options: [{ v: "待启动", l: "待启动" }, { v: "进行中", l: "进行中" }, { v: "已完成", l: "已完成" }, { v: "暂停", l: "暂停" }] },
    { key: "ownerId", label: "负责人", type: "select", options: state.db.members.map(m => ({ v: m.id, l: m.name })) },
    { key: "start", label: "开始日期", type: "date" }, { key: "end", label: "结束日期", type: "date" },
    { key: "progress", label: "进度(%)", type: "number" },
  ], p));
  const collab = (p.collaborators || []);
  const sel = (state.db.members || []).map(m => `<label class="chk"><input type="checkbox" class="collab-chk" value="${m.id}" ${collab.includes(m.id) ? "checked" : ""}> ${esc(m.name)}</label>`).join("");
  $("#modalBody").insertAdjacentHTML("afterbegin", aiBtn("plan", "desc", { hint: "让 AI 帮你起草计划说明（背景、目标、执行节奏）。" }));
  $("#modalBody").insertAdjacentHTML("beforeend", `<div class="field" style="margin-top:10px"><label>邀请协助成员（选中后，对方在「我的工作计划」中可见此计划，并可编辑）</label><div class="chk-list">${sel}</div></div>`);
  $("#formSubmit").onclick = async () => {
    const fd = readForm(); if (!fd.title) return toast("请填标题");
    fd.collaborators = [...document.querySelectorAll(".collab-chk:checked")].map(x => x.value);
    if (!fd.ownerId) fd.ownerId = state.user;
    fd.progress = Number(fd.progress) || 0;
    id ? await api("PUT", `/plans/${id}`, fd) : await api("POST", "/plans", fd);
    closeModal(); toast("已保存");
  };
};

function renderProposals(main) {
  const list = state.db.proposals.filter(p => matches(p, state.query));
  main.innerHTML = `<div class="page-head"><div><h2>方案（AI 写 / 改 / 版本）</h2><div class="sub">AI 起草、AI 改写、版本历史自动归档；改写结果可先入想法库私有打磨，确认后升版定稿</div></div>
    <div class="row"><button class="btn btn-primary" onclick="openPropForm()">＋ 新建方案</button>
    <button class="btn" onclick="aiWriteProposal()">🤖 AI 生成方案</button></div></div>
    <div class="grid cols-2">${list.map(p => {
      const nHist = (p.versions || []).length;
      return `
      <div class="card"><div class="row" style="justify-content:space-between"><h3>${esc(p.title)}</h3><span class="chip ${statusChip(p.status)}">${p.status}</span></div>
      <div class="doc-body" style="max-height:160px;overflow:auto">${esc(p.content)}</div>
      <div class="meta">v${p.version} · ${mName(p.createdBy)} · ${timeAgo(p.updatedAt || Date.now())}
      ${p.customerId ? `· 客户 <span class="linked" onclick="goto('customers')">${cName(p.customerId)}</span>` : ""}
      ${p.relatedTaskId ? `· 任务 <span class="linked" onclick="goto('planexec')">${tName(p.relatedTaskId)}</span>` : ""}
      ${nHist ? `· <span class="linked" onclick="openVersionModal('${p.id}')">🕘 ${nHist + 1} 个版本</span>` : ""}</div>
      <div class="row" style="margin-top:10px;flex-wrap:wrap;gap:6px"><button class="btn btn-sm" onclick="openPropForm('${p.id}')">编辑/改版</button>
      <button class="btn btn-sm btn-primary" onclick="openRewriteModal('${p.id}')">✨ AI 改写</button>
      ${nHist ? `<button class="btn btn-sm" onclick="openVersionModal('${p.id}')">🕘 版本历史</button>` : ""}
      <button class="btn btn-sm btn-danger" onclick="del('proposals','${p.id}')">删除</button></div></div>`;
    }).join("") || "<div class='empty'>暂无方案</div>"}</div>`;
}
// 把关联任务格式化为可拉入修改台的文本
function formatTaskText(t) {
  const plan = state.db.plans.find(p => p.id === t.planId);
  return `【关联任务】${t.title}\n【所属计划】${plan ? plan.title : "—"}\n【任务状态】${t.status || "todo"}\n【任务说明】${t.desc || "（无描述）"}\n\n`;
}
// 更新方案表单里的任务预览窗口
window.updatePropTaskPreview = () => {
  const box = $("#propTaskPreview"); if (!box) return;
  const sel = $('#modalBody [name="relatedTaskId"]');
  const tid = sel ? sel.value : "";
  const t = state.db.tasks.find(x => x.id === tid);
  if (!t) {
    box.innerHTML = `<div class="muted" style="padding:4px 0">未选择关联任务。在上方「关联任务」中选择后，此处显示任务详情预览，可拖入内容区让 AI 修改。</div>`;
    box.draggable = false;
    return;
  }
  const plan = state.db.plans.find(p => p.id === t.planId);
  box.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
      <b>${esc(t.title)}</b><span class="chip ${statusChip(t.status)}">${esc(t.status || "todo")}</span></div>
    ${plan ? `<div class="muted" style="margin-bottom:4px">📁 所属计划：${esc(plan.title)}</div>` : ""}
    <div style="white-space:pre-wrap">${esc(t.desc || "（无描述）")}</div>
    <div class="row" style="justify-content:flex-end;margin-top:8px">
      <span class="muted" style="font-size:12px;margin-right:8px">拖拽我到内容区，或</span>
      <button class="btn btn-sm btn-primary" type="button" id="pullTaskBtn">⤵️ 拉入修改台</button></div>`;
  box.draggable = true;
  box.ondragstart = (e) => {
    e.dataTransfer.setData("text/plain", formatTaskText(t));
    e.dataTransfer.effectAllowed = "copy";
  };
  const btn = $("#pullTaskBtn");
  if (btn) btn.onclick = () => pullTaskToEditor(t.id);
};
// 把任务文本插入方案内容编辑区（光标处）
window.pullTaskToEditor = (tid) => {
  const t = state.db.tasks.find(x => x.id === tid); if (!t) return;
  const ta = $('#modalBody [name="content"]'); if (!ta) return;
  insertAtCursor(ta, formatTaskText(t));
  toast("任务已拉入修改台，可点「🤖 AI 协助填写」让 AI 基于它修改");
};
window.openPropForm = (id) => {
  const p = id ? state.db.proposals.find(x => x.id === id) : {};
  const isEdit = !!id;
  openModal(isEdit ? "编辑 / 改版方案" : "新建方案", formHTML([
    { key: "title", label: "方案标题" },
    { key: "content", label: isEdit ? "内容（保存即生成新版本）" : "内容", type: "textarea" },
    { key: "status", label: "状态", type: "select", options: ["草稿", "评审中", "已定稿"].map(s => ({ v: s, l: s })) },
    { key: "customerId", label: "关联客户(可选)", type: "select", options: [{ v: "", l: "无" }, ...state.db.customers.map(c => ({ v: c.id, l: c.name + (c.type ? `（${c.type}端）` : "") }))] },
    { key: "relatedTaskId", label: "关联任务(可选)", type: "select", options: [{ v: "", l: "无" }, ...state.db.tasks.map(t => ({ v: t.id, l: t.title }))] },
  ], p) + (isEdit ? `<div class="muted" style="margin:6px 0">当前 v${p.version}，保存后将升级为 v${p.version + 1}</div>` : "") + `
    <div class="field" style="margin-top:10px">
      <label>📋 关联任务预览（小窗口 · 拖拽到内容区 / 拉入修改台，让 AI 基于任务改方案）</label>
      <div class="prop-task-preview" id="propTaskPreview"></div>
    </div>`);
  $("#modalBody").insertAdjacentHTML("afterbegin", aiBtn("proposal", "content", { hint: "让 AI 帮你起草方案正文（背景、策略、步骤、KPI）。也可先拉入关联任务，让 AI 基于任务说明修改。" }));
  // 关联任务变化 → 刷新预览
  const relSel = $('#modalBody [name="relatedTaskId"]');
  if (relSel) relSel.addEventListener("change", updatePropTaskPreview);
  updatePropTaskPreview();
  // 内容区支持拖放接收任务文本
  const ta = $('#modalBody [name="content"]');
  if (ta) {
    ta.addEventListener("dragover", e => { e.preventDefault(); ta.classList.add("drop-target"); });
    ta.addEventListener("dragleave", () => ta.classList.remove("drop-target"));
    ta.addEventListener("drop", e => {
      e.preventDefault(); ta.classList.remove("drop-target");
      const text = e.dataTransfer.getData("text/plain");
      if (text) { insertAtCursor(ta, text); toast("已拖入修改台"); }
    });
  }
  $("#formSubmit").onclick = async () => {
    const fd = readForm(); if (!fd.title) return toast("请填标题");
    if (isEdit) fd.version = p.version + 1;
    id ? await api("PUT", `/proposals/${id}`, fd) : await api("POST", "/proposals", fd);
    closeModal(); toast("已保存" + (isEdit ? "（新版本）" : ""));
  };
};
window.aiWriteProposal = () => {
  openModal("🤖 AI 生成方案", formHTML([
    { key: "title", label: "方案标题", placeholder: "如：肠道健康管理商业计划书" },
    { key: "prompt", label: "给 AI 的指令", type: "textarea", placeholder: "描述你要的方案要点、受众、结构…" },
    { key: "customerId", label: "关联客户(可选)", type: "select", options: [{ v: "", l: "无" }, ...state.db.customers.map(c => ({ v: c.id, l: c.name + (c.type ? `（${c.type}端）` : "") }))] },
    { key: "relatedTaskId", label: "关联任务(可选)", type: "select", options: [{ v: "", l: "无" }, ...state.db.tasks.map(t => ({ v: t.id, l: t.title }))] },
  ], {}) + attWidgetHTML("aiwp", { hint: "上传参考资料（图片/文档），执行时自动解析给 AI" }));
  $("#formSubmit").onclick = async () => {
    const fd = readForm(); if (!fd.title || !fd.prompt) return toast("标题和指令必填");
    const atts = attPayload("aiwp");
    const a = await api("POST", "/aiTasks", { title: "撰写方案：" + fd.title, prompt: fd.prompt, linkedType: "proposal", linkedId: "", status: "待处理", ...(atts.length ? { attachmentIds: atts.map(x => x.id) } : {}) });
    closeModal(); toast("已生成 AI 任务，去任务台交给斜杠喵"); goto("aidesk");
  };
};

// ---------- 方案 AI 改写台 + 版本历史（方案库 ↔ 想法库 双向打通） ----------
// 改写结果暂存（弹窗内存活，不落库）
const _rw = { pid: null, result: "", baseVersion: 1, engine: "" };
window.openRewriteModal = (id) => {
  const p = state.db.proposals.find(x => x.id === id); if (!p) return;
  if (!state.canEdit) return toast("AI 改写需要协作者/管理员权限");
  _rw.pid = id; _rw.result = ""; _rw.engine = "";
  const verOpts = [{ v: p.version, l: `当前 v${p.version}` },
    ...(p.versions || []).slice().sort((a, b) => b.v - a.v).map(v => ({ v: v.v, l: `历史 v${v.v}` }))];
  const ctxId = "rw";
  openModal("✨ AI 改写 · " + p.title, `
    <div class="field"><label>基于版本</label>
      <select id="rwBase">${verOpts.map(o => `<option value="${o.v}">${o.l}</option>`).join("")}</select></div>
    <div class="field"><label>改写指令</label>
      <textarea id="rwInstr" placeholder="如：语气更专业、压缩到一半篇幅、补充预算与排期、面向 C 端客户重写价值部分…"></textarea></div>
    <div class="rw-quick">
      ${["更精简", "更正式专业", "补充KPI", "面向客户重写", "增加风险合规"].map(q =>
        `<button class="chip rw-chip" onclick="rwQuick(this)">${q}</button>`).join("")}
    </div>
    ${attWidgetHTML(ctxId, { hint: "可上传参考文档/图片，AI 将提取内容并纳入改写参考" })}
    <div class="rw-stage" id="rwStage"></div>
    <div class="row" style="justify-content:flex-end;margin-top:10px;gap:8px">
      <button class="btn" onclick="closeModal()">关闭</button>
      <button class="btn btn-primary" id="rwGo">🚀 开始改写</button>
    </div>`, { wide: true });
  $("#rwGo").onclick = rwRun;
};
window.rwQuick = (el) => {
  const ta = $("#rwInstr"); if (!ta) return;
  const t = el.textContent.trim();
  ta.value = ta.value ? ta.value.replace(/[，,]?\s*$/, "") + "，" + t : t;
  ta.focus();
};
async function rwRun() {
  const p = state.db.proposals.find(x => x.id === _rw.pid); if (!p) return;
  const instr = ($("#rwInstr").value || "").trim();
  const baseVersion = Number($("#rwBase").value) || p.version;
  if (!instr) return toast("请填写改写指令");
  const stage = $("#rwStage"), go = $("#rwGo");
  go.disabled = true; go.innerHTML = "⏳ AI 改写中…";
  stage.innerHTML = `<div class="rw-loading"><span class="rw-dot"></span><span class="rw-dot"></span><span class="rw-dot"></span> 斜杠喵正在基于 v${baseVersion} 改写方案…</div>`;
  try {
    const atts = attPayload("rw");
    const r = await api("POST", `/proposals/${_rw.pid}/rewrite`, { instruction: instr, baseVersion, attachments: atts.map(a => a.id) });
    _rw.result = r.result; _rw.baseVersion = r.baseVersion; _rw.engine = r.engine || "";
    const vs = (p.versions || []).find(v => v.v === r.baseVersion);
    const baseContent = vs ? vs.content : p.content;
    stage.innerHTML = `
      <div class="rw-compare">
        <div class="rw-pane"><div class="rw-pane-h">📄 原文 v${r.baseVersion}</div>
          <div class="rw-pane-b">${esc((baseContent || "").slice(0, 1200))}${(baseContent || "").length > 1200 ? "…" : ""}</div></div>
        <div class="rw-pane rw-pane-new"><div class="rw-pane-h">✨ AI 改写稿${r.engine === "workbuddy" ? "" : "（模板兜底）"}</div>
          <div class="rw-pane-b">${esc(r.result)}</div></div>
      </div>
      <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px">
        <button class="btn" id="rwRetry">🔁 换个指令重写</button>
        <button class="btn" id="rwCopy">📋 复制全文</button>
        <span style="flex:1"></span>
        <button class="btn btn-primary" id="rwDraft">📝 存入想法库</button>
        <button class="btn btn-primary" id="rwApply">⬆️ 升版定稿</button>
      </div>`;
    $("#rwRetry").onclick = () => { stage.innerHTML = ""; go.disabled = false; go.innerHTML = "🚀 开始改写"; };
    $("#rwCopy").onclick = () => { navigator.clipboard && navigator.clipboard.writeText(_rw.result); toast("已复制改写全文"); };
    $("#rwDraft").onclick = rwToDraft;
    $("#rwApply").onclick = rwApply;
  } catch (e) {
    stage.innerHTML = `<div class="muted">改写失败：${esc(e.message || "")}</div>`;
  } finally {
    go.disabled = false; go.innerHTML = "🚀 开始改写";
  }
}
// 改写结果 → 想法库（私有打磨，写完再发平台）
async function rwToDraft() {
  const p = state.db.proposals.find(x => x.id === _rw.pid); if (!p || !_rw.result) return;
  try {
    await api("POST", "/drafts", {
      title: p.title + " · 改写候选", content: _rw.result,
      ownerId: state.user, status: "草稿", source: "rewrite",
      proposalId: p.id, baseVersion: _rw.baseVersion,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    toast("已存入想法库（仅自己可见），打磨好可再「转为方案」");
  } catch (e) { toast("存想法库失败：" + (e.message || "")); }
}
// 改写结果 → 升版定稿（旧版本自动归档）
async function rwApply() {
  const p = state.db.proposals.find(x => x.id === _rw.pid); if (!p || !_rw.result) return;
  try {
    await api("PUT", `/proposals/${_rw.pid}`, {
      content: _rw.result, version: (Number(p.version) || 1) + 1,
      _versionNote: "AI 改写", _actor: state.user,
    });
    closeModal(); toast(`已升版为 v${(Number(p.version) || 1) + 1}，旧版本已归档`);
    render();
  } catch (e) { toast("升版失败：" + (e.message || "")); }
}
// 版本历史：查看 / 恢复 / 存入想法库
window.openVersionModal = (id) => {
  const p = state.db.proposals.find(x => x.id === id); if (!p) return;
  const hist = (p.versions || []).slice().sort((a, b) => b.v - a.v);
  const rows = [
    { v: Number(p.version) || 1, content: p.content, by: p.createdBy, updatedAt: p.updatedAt, note: "当前版本", cur: true },
    ...hist.map(v => ({ ...v, cur: false })),
  ].map(r => `
    <div class="rw-ver ${r.cur ? "rw-ver-cur" : ""}">
      <div class="row" style="justify-content:space-between">
        <b>v${r.v}${r.cur ? " · 当前" : ""}${r.note && !r.cur ? " · " + esc(r.note) : ""}</b>
        <span class="muted" style="font-size:12px">${mName(r.by)} · ${timeAgo(r.updatedAt || Date.now())}</span>
      </div>
      <div class="rw-pane-b" style="max-height:110px;overflow:auto">${esc((r.content || "").slice(0, 600))}${(r.content || "").length > 600 ? "…" : ""}</div>
      <div class="row" style="margin-top:6px;gap:8px">
        ${r.cur ? "" : `<button class="btn btn-sm" onclick="propRestoreVer('${p.id}',${r.v})">↩️ 恢复此版本</button>`}
        <button class="btn btn-sm" onclick="propVerToDraft('${p.id}',${r.v})">📄 存入想法库</button>
      </div>
    </div>`).join("");
  openModal("🕘 版本历史 · " + p.title, `<div class="rw-vers">${rows || "<div class='empty'>暂无历史版本</div>"}</div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" onclick="closeModal()">关闭</button></div>`, { wide: true });
};
window.propRestoreVer = async (pid, v) => {
  const p = state.db.proposals.find(x => x.id === pid); if (!p) return;
  if (!state.canEdit) return toast("恢复版本需要协作者/管理员权限");
  const ver = (p.versions || []).find(x => x.v === v); if (!ver) return;
  if (!confirm(`恢复到 v${v}？当前内容会归档为新历史版本，版本号升为 v${(Number(p.version) || 1) + 1}`)) return;
  try {
    await api("PUT", `/proposals/${pid}`, {
      content: ver.content, version: (Number(p.version) || 1) + 1,
      _versionNote: "恢复自 v" + v, _actor: state.user,
    });
    closeModal(); toast(`已恢复 v${v} 的内容（当前为 v${(Number(p.version) || 1) + 1}）`);
    render();
  } catch (e) { toast("恢复失败：" + (e.message || "")); }
};
window.propVerToDraft = async (pid, v) => {
  const p = state.db.proposals.find(x => x.id === pid); if (!p) return;
  const ver = v === (Number(p.version) || 1) ? { content: p.content } : (p.versions || []).find(x => x.v === v);
  if (!ver) return;
  try {
    await api("POST", "/drafts", {
      title: p.title + " · v" + v, content: ver.content || "",
      ownerId: state.user, status: "草稿", source: "proposal", proposalId: pid, baseVersion: v,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    toast("已存入想法库（仅自己可见）");
  } catch (e) { toast("存想法库失败：" + (e.message || "")); }
};

// ---------- 媒体库 ----------
// 在 textarea 光标处插入文本
window.insertAtCursor = (ta, text) => {
  if (!ta) return;
  const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
  const e = ta.selectionEnd == null ? ta.value.length : ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.focus();
  const pos = s + text.length;
  ta.selectionStart = ta.selectionEnd = pos;
};
// 富媒体内容：把 ![图片](url) / ![视频](url) 语法渲染成真实标签
function renderRichContent(text) {
  if (!text) return "";
  let s = esc(text);
  s = s.replace(/!\[图片\]\(([^)\s]+)\)/g, (m0, u) => `<img src="${u}" alt="" loading="lazy" style="max-width:100%;border-radius:10px;margin:8px 0;display:block">`);
  s = s.replace(/!\[视频\]\(([^)\s]+)\)/g, (m0, u) => `<video src="${u}" controls playsinline style="max-width:100%;border-radius:10px;margin:8px 0;display:block"></video>`);
  s = s.replace(/\n/g, "<br>");
  return s;
}
function mediaThumb(m) {
  const u = m.url || "";
  const isImg = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(u) || m.kind === "图片海报";
  const isVid = /\.(mp4|webm|ogg|mov)$/i.test(u) || m.kind === "视频";
  if (isImg && u) return `<img src='${esc(u)}' alt='' loading='lazy'>`;
  if (isVid && u) return `<video src='${esc(u)}' muted preload='metadata'></video>`;
  return `<div class='media-thumb-icon'>${MEDIA_ICON[m.kind] || "📁"}</div>`;
}
function mediaCard(m) {
  const pushed = m.pushedTo || [];
  return `<div class='card media-card' onclick='previewMedia("${m.id}")'>
    <div class='media-thumb'>${mediaThumb(m)}</div>
    <div class='row' style='justify-content:space-between;margin-top:8px'><span class='chip brand'>${MEDIA_ICON[m.kind] || "📁"} ${esc(m.kind || "未分类")}</span><span class='chip'>${esc(m.region || "通用")}</span></div>
    <h3 style='margin:6px 0 4px;font-size:15px'>${esc(m.title)}</h3>
    <div class='muted' style='font-size:13px;flex:1'>${esc(m.desc || "")}</div>
    <div style='margin:8px 0'>${(m.tags || []).slice(0, 4).map(t => `<span class='chip'>${esc(t)}</span>`).join("") || ""}</div>
    <div class='row' style='gap:6px;flex-wrap:wrap;margin-top:auto'>
      <button class='btn btn-sm btn-primary' onclick='event.stopPropagation();openForwardModal("${m.id}")'>↗ 转发</button>
      <button class='btn btn-sm' onclick='event.stopPropagation();openMediaForm("${m.id}")'>编辑</button>
      <button class='btn btn-sm btn-danger' onclick='event.stopPropagation();del("media","${m.id}")'>删</button>
    </div>
    <div class='meta' style='margin-top:6px'>已推送 ${pushed.length} 个客户${m.pushedWechat ? ` · <span style="color:#07c160">✓ 公众号 ${esc(m.pushedWechat)}</span>` : ""}</div>
  </div>`;
}
let mediaCatFilter = "全部素材";
window.setMediaCat = (c) => { mediaCatFilter = c; render(); };
function renderMedia(main) {
  const allList = state.db.media.filter(m => matches(m, state.query));
  const kindOf = m => m.kind || "未分类";
  const catOf = m => m.category || "未分类";
  // 区域筛选
  const regFiltered = mediaRegionTab === "全部区域" ? allList : allList.filter(m => (m.region || "通用") === mediaRegionTab);
  // 左侧分类导航：全部素材 + 按 kind 分类
  const kinds = [];
  regFiltered.forEach(m => { const k = kindOf(m); if (!kinds.includes(k)) kinds.push(k); });
  const kindOrdered = [...MEDIA_KINDS.filter(k => kinds.includes(k)), ...kinds.filter(k => !MEDIA_KINDS.includes(k))];
  const catNavItems = [
    { key: "全部素材", label: "全部素材", icon: "📁", count: regFiltered.length },
    ...kindOrdered.map(k => ({ key: k, label: k, icon: MEDIA_ICON[k] || "📁", count: regFiltered.filter(m => kindOf(m) === k).length }))
  ];
  const catNav = `<div class="media-catnav">
    <div class="media-catnav-title">分类导航</div>
    ${catNavItems.map(item => `
      <div class="media-catnav-item ${mediaCatFilter === item.key ? 'active' : ''}" onclick="setMediaCat('${item.key}')">
        <span class="media-catnav-icon">${item.icon}</span>
        <span class="media-catnav-label">${esc(item.label)}</span>
        <span class="media-catnav-count">${item.count}</span>
      </div>
    `).join("")}
  </div>`;
  // 右侧内容：按分类筛选
  const list = mediaCatFilter === "全部素材" ? regFiltered : regFiltered.filter(m => kindOf(m) === mediaCatFilter);
  // 区域内再按分类细分
  const cats = [];
  list.forEach(m => { const c = catOf(m); if (!cats.includes(c)) cats.push(c); });
  const ordered = cats.slice().sort((a, b) => list.filter(m => catOf(m) === b).length - list.filter(m => catOf(m) === a).length);
  const blocks = ordered.map((cat, i) => {
    const items = list.filter(m => catOf(m) === cat);
    if (!items.length) return "";
    return `<section class="media-block" id="msec-${i}">
      <div class="media-block-head"><span class="media-block-title">${esc(cat)}</span><span class="chip muted-chip">${items.length} 项</span></div>
      <div class="grid cols-3">${items.map(mediaCard).join("")}</div>
    </section>`;
  }).join("") || "<div class='empty'>当前分类下暂无素材</div>";
  // 区域筛选 tabs（放在右侧顶部）
  const regionTabs = `<div class="row" style="gap:6px;flex-wrap:wrap">${MEDIA_REGIONS.map(r =>
    `<button class="btn btn-sm ${mediaRegionTab === r ? "btn-primary" : ""}" onclick="setMediaRegion('${r}')">${r} ${r === "全部区域" ? allList.length : allList.filter(m => (m.region || "通用") === r).length}</button>`).join("")}</div>`;
  main.innerHTML = `
    <div class="media-layout">
      ${catNav}
      <div class="media-main">
        <div class="page-head"><div><h2>媒体库</h2><div class="sub">${mediaCatFilter === "全部素材" ? "全部素材" : esc(mediaCatFilter)} · ${list.length} 项</div></div>
          <div class="row" style="gap:8px"><button class="btn" onclick="openSugooVideo()">🎬 AI 短视频</button>
          <button class="btn btn-primary" onclick="openMediaForm()">＋ 新增素材</button></div></div>
        <div class="media-toolbar">
          <div class="media-toolbar-row"><span class="media-toolbar-label">区域</span>${regionTabs}</div>
        </div>
        <div class="media-blocks">${blocks}</div>
      </div>
    </div>`;
}
window.previewMedia = (id) => {
  const m = state.db.media.find(x => x.id === id); if (!m) return;
  const u = m.url || "";
  const isImg = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(u) || m.kind === "图片海报";
  const isVid = /\.(mp4|webm|ogg|mov)$/i.test(u) || m.kind === "视频";
  let body = "";
  if (isImg && u) body = `<img class='lb-img' src='${esc(u)}'>`;
  else if (isVid && u) body = `<video class='lb-video' src='${esc(u)}' controls autoplay></video>`;
  else if (u && u.startsWith("/uploads/")) {
    if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(u)) body = `<img class='lb-img' src='${esc(u)}'>`;
    else if (/\.(mp4|webm|ogg|mov)$/i.test(u)) body = `<video class='lb-video' src='${esc(u)}' controls autoplay></video>`;
    else body = `<div class='lb-file'><div style='font-size:60px'>📄</div><a class='btn btn-primary' href='${esc(u)}' target='_blank' download>⬇️ 下载文件</a></div>`;
  }
  else if ((m.kind === "图文文章" || m.kind === "图文") && m.content) body = `<div class='doc-body rich-body' style='max-height:60vh;overflow:auto'>${renderRichContent(m.content)}</div>`;
  else if (u) body = `<div class='lb-link'><p class='muted'>外部链接</p><a class='btn btn-primary' href='${esc(u)}' target='_blank' rel='noopener'>🔗 打开链接</a></div>`;
  else body = `<div class='muted'>该素材暂无可预览内容</div>`;
  const lb = $("#lightbox");
  lb.innerHTML = `<div class='lb-backdrop' onclick='closeLightbox()'></div>
    <div class='lb-panel'>
      <div class='lb-head'><span>${esc(m.category || "")}</span><button class='x' onclick='closeLightbox()'>✕</button></div>
      <div class='lb-body'>${body}</div>
      <div class='lb-meta'>${MEDIA_ICON[m.kind] || "📁"} <b>${esc(m.title)}</b> · ${esc(m.kind)} · ${esc(m.region || "通用")}${m.desc ? " · " + esc(m.desc) : ""}${m.pushedWechat ? " · <span class='chip' style='background:#07c160;color:#fff'>已推公众号 " + esc(m.pushedWechat) + "</span>" : ""}</div>
      <div class='row' style='gap:6px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap'>
        ${u ? `<a class='btn btn-sm' href='${esc(u)}' target='_blank' rel='noopener'>🔗 打开原链接</a>` : ""}
        <button class='btn btn-sm' style='background:#07c160;color:#fff;border-color:#07c160' onclick='openWechatPush("${m.id}")'>📱 推送公众号</button>
        <button class='btn btn-sm' onclick='closeLightbox();openForwardModal("${m.id}")'>↗ 转发</button>
        <button class='btn btn-sm' onclick='closeLightbox();openMediaForm("${m.id}")'>编辑</button>
      </div>
    </div>`;
  lb.classList.remove("hidden");
};
window.closeLightbox = () => { const lb = $("#lightbox"); if (lb) { lb.classList.add("hidden"); lb.innerHTML = ""; } };
// ---------- 微信公众号推送（绑定账号 / 复制草稿 / 标记已推） ----------
window.openWechatPush = (id) => {
  const m = state.db.media.find(x => x.id === id); if (!m) return;
  const bound = localStorage.getItem("qb_wechat_account") || "";
  const digest = (m.content || m.desc || "").replace(/\s+/g, " ").trim().slice(0, 54);
  const fullDraft = `【${m.title}】\n\n${digest}${(m.content || "").length > 54 ? "…" : ""}\n\n${m.content || m.desc || ""}\n\n${m.url ? "原文链接：" + m.url + "\n" : ""}—— 来自 乔本·数果 AI 工作台`;
  openModal("📱 推送到微信公众号", `
    <div class="wx-push">
      <div class="wx-bind card" style="padding:10px;margin-bottom:12px">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div><b>绑定公众号</b><div class="muted" style="font-size:12px">${bound ? "当前绑定：「" + esc(bound) + "」" : "尚未绑定，填入公众号名称便于团队识别"}</div></div>
          <div class="row" style="gap:6px"><input id="wxAccount" class="ipt" style="width:160px" placeholder="公众号名称" value="${esc(bound)}"><button class="btn btn-sm" id="wxBin">绑定</button></div>
        </div>
      </div>
      <h4 style="margin:6px 0">草稿预览（编辑后再复制）</h4>
      <div class="field"><label>标题</label><input id="wxTitle" class="ipt" value="${esc(m.title)}" /></div>
      <div class="field"><label>摘要（公众号列表显示，≤54字）</label><input id="wxDigest" class="ipt" value="${esc(digest)}" /></div>
      <div class="field"><label>正文</label><textarea id="wxBody" class="ipt" style="min-height:180px">${esc(m.content || m.desc || "")}</textarea></div>
      <div class="row" style="gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-sm" id="wxCopy">📋 复制草稿全文</button>
        <a class="btn btn-sm" href="https://mp.weixin.qq.com" target="_blank" rel="noopener">🔗 打开公众号后台</a>
        <button class="btn btn-primary btn-sm" id="wxMark" style="background:#07c160;border-color:#07c160">✅ 标记已推送</button>
      </div>
      <div class="muted" style="font-size:12px;margin-top:8px">流程：预览编辑草稿 → 复制全文 → 打开公众号后台新建图文 → 粘贴发布。绑定账号仅保存在本机。</div>
    </div>`);
  $("#wxBin").onclick = () => {
    const v = ($("#wxAccount").value || "").trim();
    if (!v) return toast("请输入公众号名称");
    localStorage.setItem("qb_wechat_account", v);
    toast("已绑定公众号「" + v + "」");
  };
  $("#wxCopy").onclick = () => {
    const draft = `【${$("#wxTitle").value}】\n\n${$("#wxDigest").value}\n\n${$("#wxBody").value}\n\n${m.url ? "原文链接：" + m.url + "\n" : ""}—— 来自 乔本·数果 AI 工作台`;
    navigator.clipboard.writeText(draft).then(() => toast("草稿已复制，去公众号后台粘贴发布"));
  };
  $("#wxMark").onclick = async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      await api("PUT", "/media/" + m.id, { pushedWechat: today });
      m.pushedWechat = today;
      closeModal(); closeLightbox(); render();
      toast("已标记推送公众号（" + today + "）");
    } catch (e) { toast("标记失败：" + e.message); }
  };
};
window.openTextMedia = (id) => {
  const m = state.db.media.find(x => x.id === id); if (!m) return;
  openModal("图文 · " + m.title, `<div class='muted' style='margin-bottom:8px'>${esc(m.desc || "")}</div><div class='doc-body rich-body' style='max-height:60vh;overflow:auto'>${renderRichContent(m.content)}</div>
    <div class='row' style='justify-content:flex-end;margin-top:10px'><button class='btn btn-primary' onclick='openForwardModal("${m.id}")'>↗ 转发此图文</button></div>`);
};
window.openMediaForm = (id) => {
  const m = id ? state.db.media.find(x => x.id === id) : {};
  openModal(id ? "编辑素材" : "新增素材", formHTML([
    { key: "title", label: "标题" },
    { key: "kind", label: "类型", type: "select", options: MEDIA_KINDS.map(k => ({ v: k, l: k })) },
    { key: "region", label: "区域分类", type: "select", options: MEDIA_REGIONS.slice(1).map(r => ({ v: r, l: r })) },
    { key: "category", label: "分类", placeholder: "如：功能文章 / 健康知识 / 品牌物料" },
    { key: "url", label: "下载/外链地址", placeholder: "https://... 或下方上传本地文件" },
    { key: "content", label: "图文内容（支持插入图片 / 视频，转发预览一并带出）", type: "textarea", placeholder: "图文正文，可多段文字，并用下方按钮插入图片视频" },
    { key: "desc", label: "说明", type: "textarea" },
    { key: "tags", label: "标签", type: "tags" },
  ], m));
  $("#modalBody").insertAdjacentHTML("afterbegin", aiBtn("media", "content", { titleField: "title", hint: "让 AI 帮你生成图文/文案/视频脚本等素材内容。" }));
  // 富媒体插入工具栏（插到内容 textarea 前面）
  const contentTA = $('#modalBody [name="content"]');
  if (contentTA) {
    const others = state.db.media.filter(x => x.url && x.id !== id);
    const bar = document.createElement("div");
    bar.className = "rich-toolbar";
    bar.innerHTML = `
      <button class="btn btn-sm" type="button" id="insImgBtn">🖼️ 插入图片</button>
      <button class="btn btn-sm" type="button" id="insVidBtn">🎬 插入视频</button>
      <button class="btn btn-sm" type="button" id="insUpBtn">⬆️ 上传并插入</button>
      <select id="insLibSel" class="rich-libsel" title="从媒体库引用已有素材">
        <option value="">📚 从媒体库引用…</option>
        ${others.map(x => `<option value='${esc(x.id)}'>${esc((x.title || "").slice(0, 22))}（${esc(x.kind || "")}）</option>`).join("")}
      </select>
      <input type="file" id="richFile" accept="image/*,video/*" hidden>`;
    contentTA.parentNode.insertBefore(bar, contentTA);
    const insertMediaRef = (kindLabel, url) => { insertAtCursor(contentTA, `\n![${kindLabel}](${url})\n`); toast(`已插入${kindLabel}`); };
    $("#insImgBtn").onclick = () => {
      const url = prompt("图片地址（https://... 或 /uploads/...）", "").trim();
      if (url) insertMediaRef("图片", url);
    };
    $("#insVidBtn").onclick = () => {
      const url = prompt("视频地址（https://... 或 /uploads/...）", "").trim();
      if (url) insertMediaRef("视频", url);
    };
    $("#insUpBtn").onclick = () => $("#richFile").click();
    $("#richFile").onchange = async () => {
      const f = $("#richFile").files[0]; if (!f) return;
      const fd2 = new FormData(); fd2.append("file", f);
      toast("上传中…");
      try {
        const r = await fetch("/api/upload", { method: "POST", headers: { "Authorization": "Bearer " + state.token }, body: fd2 });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "上传失败");
        const kindLabel = /^video\//.test(f.type) ? "视频" : "图片";
        insertMediaRef(kindLabel, d.url);
        // 若主地址为空则顺便填上
        const urlEl = $('[name="url"]'); if (urlEl && !urlEl.value) urlEl.value = d.url;
      } catch (e) { toast("上传失败：" + e.message); }
      $("#richFile").value = "";
    };
    $("#insLibSel").onchange = () => {
      const mid = $("#insLibSel").value; if (!mid) return;
      const x = state.db.media.find(y => y.id === mid); if (!x || !x.url) return;
      const kindLabel = x.kind === "视频" ? "视频" : "图片";
      insertMediaRef(kindLabel, x.url);
      $("#insLibSel").value = "";
    };
  }
  // 上传本地文件（作为素材主文件）
  $("#modalBody").insertAdjacentHTML("beforeend", `<div class="field" style="margin-top:10px"><label>或上传本地文件作为素材主文件（图片 / 视频 / 文档，≤50MB）</label><input id="mediaFile" type="file"><div class="row" style="margin-top:6px"><button class="btn btn-sm" id="uploadBtn" type="button">⬆️ 上传并填入地址</button><span id="uploadHint" class="muted" style="font-size:12px"></span></div></div>`);
  $("#uploadBtn").onclick = async () => {
    const f = $("#mediaFile").files[0]; if (!f) return toast("请先选择文件");
    const fd2 = new FormData(); fd2.append("file", f);
    $("#uploadHint").textContent = "上传中…";
    try {
      const r = await fetch("/api/upload", { method: "POST", headers: { "Authorization": "Bearer " + state.token }, body: fd2 });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "上传失败");
      const urlEl = $('[name="url"]'); if (urlEl) urlEl.value = d.url;
      $("#uploadHint").textContent = "已上传：" + (d.name || d.url);
      toast("上传成功");
    } catch (e) { $("#uploadHint").textContent = ""; toast("上传失败：" + e.message); }
  };
  $("#formSubmit").onclick = async () => {
    const fd = readForm(); if (!fd.title) return toast("请填标题");
    id ? await api("PUT", `/media/${id}`, fd) : await api("POST", "/media", fd);
    closeModal(); toast("已保存");
  };
};
window.openPushModal = (id) => {
  const m = state.db.media.find(x => x.id === id); if (!m) return;
  const pushed = m.pushedTo || [];
  const opts = state.db.customers.map(c => ({ v: c.id, l: `${c.name}（${c.type === 'B' ? c.tier : 'C端'}）` }));
  openModal("推送给客户 · " + m.title, `
    <div class='field'><label>选择要推送的客户（可多选）</label>
      <div id='pushList' style='max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:6px'>
      ${opts.map(o => `<label style='display:flex;gap:8px;align-items:center;padding:5px 4px;font-size:13px'><input type='checkbox' value='${o.v}' ${pushed.includes(o.v) ? "checked" : ""}/> ${esc(o.l)}</label>`).join("")}
      </div></div>
    <div class='row' style='justify-content:flex-end;margin-top:8px'><button class='btn' onclick='closeModal()'>取消</button>
      <button class='btn btn-primary' id='formSubmit'>确认推送</button></div>`);
  $("#formSubmit").onclick = async () => {
    const ids = $$("#pushList input:checked").map(el => el.value);
    await api("PUT", `/media/${id}`, { pushedTo: ids });
    toast(`已推送给 ${ids.length} 个客户`);
    closeModal();
  };
};
window.openForwardModal = (id) => {
  const m = state.db.media.find(x => x.id === id); if (!m) return;
  const shareUrl = `${location.origin}/?media=${m.id}`;
  openModal("转发 · " + m.title, `
    <div class='field'><label>分享链接（可转发到微信 / 社群 / 客户）</label>
      <div class='share-box' id='shareUrl'>${esc(shareUrl)}</div></div>
    <div class='row' style='gap:8px;margin:10px 0'>
      <button class='btn btn-sm btn-primary' id='copyShare'>📋 复制链接</button>
      <button class='btn btn-sm' onclick='openPushModal("${m.id}")'>📤 推送给客户</button>
      ${m.url ? `<a class='btn btn-sm' href='${esc(m.url)}' target='_blank' rel='noopener' download>⬇️ 下载原文件</a>` : ""}
    </div>
    <div class='muted' style='font-size:12px'>转发后客户 / 伙伴打开链接即可查看该素材（图文内容一并带出）。</div>`);
  $("#copyShare").onclick = () => { navigator.clipboard.writeText(shareUrl); toast("链接已复制，去转发吧"); };
};

function kanbanHTML() {
  const cols = [{ s: "todo", l: "待办" }, { s: "doing", l: "进行中" }, { s: "done", l: "已完成" }];
  const q = state.query;
  return `<div class="kanban">${cols.map(c => {
    const ts = state.db.tasks.filter(t => t.status === c.s && matches(t, q) && (taskCatTab === "全部" || t.category === taskCatTab));
    return `<div class="kcol"><h4>${c.l}<span class="chip">${ts.length}</span></h4>${ts.map(t => `
      <div class="ktask"><div class="t">${esc(t.title)}</div>
      <div class="m"><b>责任人</b> ${ownerBadge(t.ownerId)}</div>
      <div class="m">${({ 高: "<span class='chip red'>高优先级</span>", 中: "<span class='chip orange'>中优先级</span>", 低: "<span class='chip'>低优先级</span>" }[t.priority] || "")} ${t.category ? `<span class='chip brand'>${esc(t.category)}</span>` : ""} 计划：${esc((state.db.plans.find(p => p.id === t.planId) || {}).title || "—")}</div>
      ${t.desc ? `<div class="m muted" style="font-size:12px;margin:2px 0">${esc(t.desc)}</div>` : ""}
      <div class="m">截止 ${t.due || "—"} ${t.status !== "done" && t.due && t.due < new Date().toISOString().slice(0, 10) ? '<span class="chip red">⚠ 超期</span>' : ""} ${t.ownerId ? "" : '<span class="chip red">⚠ 待指派</span>'}</div>
      <div class="bar"><i style="width:${t.progress || 0}%"></i></div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px"><button class="btn btn-sm" onclick="cycleTask('${t.id}')">→ 推进</button>
      <button class="btn btn-sm" onclick="openTaskDetail('${t.id}')">详情</button>
      ${t.ownerId !== state.user ? `<button class="btn btn-sm btn-primary" onclick="claimTask('${t.id}')">领取</button>` : ""}
      ${t.ownerId === state.user ? `<button class="btn btn-sm" onclick="openTransferModal('${t.id}')">转让给</button>` : ""}
      <button class="btn btn-sm btn-danger" onclick="del('tasks','${t.id}')">删</button></div></div>`).join("") || "<div class='muted' style='font-size:12px'>空</div>"}</div>`;
  }).join("")}</div>`;
}

function renderPlanExec(main) {
  const me = state.user;
  const plans = state.db.plans, tasks = state.db.tasks;
  const myPlans = plans.filter(p => p.ownerId === me || (p.collaborators || []).includes(me));
  const myTaskSet = new Set(tasks.filter(t => t.ownerId === me || canEditPlan(plans.find(p => p.id === t.planId))).map(t => t.id));
  const myTasks = tasks.filter(t => myTaskSet.has(t.id));

  const planCard = (p) => {
    const collab = (p.collaborators || []);
    const mine = p.ownerId === me || collab.includes(me);
    const editable = canEditPlan(p);
    return `<div class="pex-card ${mine ? "mine" : ""}">
      <div class="pex-card-head"><b>${esc(p.title)}</b>${mine ? '<span class="chip brand">我的</span>' : ""}</div>
      <div class="muted" style="font-size:12px">${esc(p.desc || "")}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin:8px 0"><span class="chip ${statusChip(p.status)}">${p.status}</span><span class="muted">负责人 ${ownerBadge(p.ownerId)}</span></div>
      ${collab.length ? `<div class="row" style="gap:4px;flex-wrap:wrap;margin-bottom:6px"><span class="muted" style="font-size:12px">协助：</span>${collab.map(c => ownerBadge(c)).join("")}</div>` : ""}
      <div class="bar"><i style="width:${p.progress || 0}%"></i></div>
      <div class="muted" style="font-size:12px;margin:4px 0">${p.start || "?"} → ${p.end || "?"} · ${p.progress || 0}%</div>
      <div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="openPlanTasks('${p.id}')">看任务</button>
        ${editable ? `<button class="btn btn-sm" onclick="openPlanForm('${p.id}')">编辑</button>` : ""}
        ${(p.ownerId === me || state.role === "admin") ? `<button class="btn btn-sm btn-danger" onclick="del('plans','${p.id}')">删除</button>` : ""}
      </div></div>`;
  };
  const taskRow = (t) => `<div class="pex-task"><div class="t">${esc(t.title)}</div>
    <div class="m">${({ 高: "<span class='chip red'>高</span>", 中: "<span class='chip orange'>中</span>", 低: "<span class='chip'>低</span>" }[t.priority] || "")} <span class='chip brand'>${esc(t.category || "—")}</span> · 计划：${esc((plans.find(p => p.id === t.planId) || {}).title || "—")}</div>
    <div class="bar"><i style="width:${t.progress || 0}%"></i></div>
    <div class="row" style="margin-top:6px;gap:6px;flex-wrap:wrap">
      <button class="btn btn-sm" onclick="openTaskDetail('${t.id}')">详情</button>
      ${canEditTask(t) ? `<button class="btn btn-sm" onclick="openTaskForm('${t.id}')">编辑</button>` : ""}
      ${(t.ownerId === me || state.role === "admin") ? `<button class="btn btn-sm btn-danger" onclick="del('tasks','${t.id}')">删</button>` : ""}
    </div></div>`;

  main.innerHTML = `<div class="page-head pex-head"><div><h2>🛰️ 计划与执行进度</h2><div class="sub">大计划 → 阶段任务 → 执行进度，全程实时同步；可邀请成员协作，对方「我的工作计划」自动出现并可编辑</div></div>
    <div class="row"><button class="btn btn-primary" onclick="openPlanForm()">＋ 新建计划（可邀请成员）</button><button class="btn" onclick="openTaskForm()">＋ 新建任务</button></div></div>

    <!-- 图表区 -->
    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="card chart-card"><h3>📊 任务状态分布</h3><div class="chart-box"><canvas id="pexPieTasks"></canvas></div></div>
      <div class="card chart-card"><h3>📈 计划进度走势</h3><div class="chart-box"><canvas id="pexTrend"></canvas></div></div>
      <div class="card chart-card"><h3>🎯 计划状态分布</h3><div class="chart-box"><canvas id="pexPiePlans"></canvas></div></div>
    </div>

    <!-- 甘特图 -->
    <div class="card pex-section" style="margin-bottom:16px"><div class="pex-section-head"><span class="pex-dot"></span>📊 甘特图时间线</div>
      <div class="gantt-wrap"><div class="gantt">
        ${plans.map(p => {
          const allStarts = plans.map(x => x.start).filter(Boolean);
          const allEnds = plans.map(x => x.end).filter(Boolean);
          const gMin = allStarts.length ? new Date(Math.min(...allStarts.map(d => new Date(d)))) : new Date();
          const gMax = allEnds.length ? new Date(Math.max(...allEnds.map(d => new Date(d)))) : new Date(Date.now() + 90*86400000);
          const gRange = gMax - gMin || 1;
          const left = ((new Date(p.start) - gMin) / gRange * 100);
          const width = Math.max(((new Date(p.end) - gMin) / gRange * 100) - left, 3);
          return `<div class="gantt-row"><div class="gantt-label" title="${esc(p.title)}">${esc(p.title)}</div><div class="gantt-bar-wrap"><div class="gantt-bar-bg"></div><div class="gantt-bar" style="left:${left}%;width:${width}%;${p.progress>=80?'background:var(--green)':p.progress>=50?'':'background:var(--orange)'}" title="${esc(p.title)} · ${p.progress}% · ${p.status}" onclick="openPlanForm('${p.id}')">${p.progress}%</div></div></div>`;
        }).join("")}
      </div></div>
    </div>

    <div class="pex-section"><div class="pex-section-head"><span class="pex-dot"></span>我的工作计划<span class="muted">（当前：${esc(mName(me))}）</span></div>
      ${myPlans.length ? `<div class="grid cols-2">${myPlans.map(planCard).join("")}</div>` : '<div class="empty">你还没有负责或被邀请的计划。点「新建计划」并邀请成员即可协作。</div>'}
      ${myTasks.length ? `<div style="margin-top:12px"><div class="muted" style="margin-bottom:6px">我负责的执行任务（${myTasks.length}）</div>${myTasks.map(taskRow).join("")}</div>` : ""}
    </div>

    <div class="pex-section"><div class="pex-section-head"><span class="pex-dot"></span>全部大计划（${plans.length}）</div>
      <div class="grid cols-2">${plans.map(planCard).join("")}</div>
    </div>

    <div class="pex-section"><div class="pex-section-head"><span class="pex-dot"></span>执行进度看板</div>${kanbanHTML()}</div>`;

  // 渲染图表
  setTimeout(() => {
    const tDone = tasks.filter(t => t.status === "done").length;
    const tDoing = tasks.filter(t => t.status === "doing").length;
    const tTodo = tasks.filter(t => t.status === "todo").length;
    makeChart("pexPieTasks", "doughnut", {
      labels: ["已完成", "进行中", "待启动"],
      datasets: [{ data: [tDone, tDoing, tTodo], backgroundColor: [CHART_COLORS.green, CHART_COLORS.brand, "#e7e9f0"], borderWidth: 0 }]
    }, { plugins: { legend: { position: "bottom" } }, cutout: "60%" });

    makeChart("pexTrend", "line", {
      labels: plans.map(p => p.title.slice(0, 8)),
      datasets: [{ label: "进度%", data: plans.map(p => p.progress || 0), borderColor: CHART_COLORS.brand, backgroundColor: "rgba(124,92,255,.1)", tension: .3, fill: true }]
    }, { plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true, max: 100, grid: { color: CHART_COLORS.grid } } } });

    const pActive = plans.filter(p => p.status === "进行中").length;
    const pDone = plans.filter(p => p.status === "已完成").length;
    const pPause = plans.filter(p => p.status === "暂停").length;
    makeChart("pexPiePlans", "pie", {
      labels: ["进行中", "已完成", "暂停"],
      datasets: [{ data: [pActive, pDone, pPause], backgroundColor: [CHART_COLORS.brand, CHART_COLORS.green, CHART_COLORS.orange], borderWidth: 0 }]
    }, { plugins: { legend: { position: "bottom" } } });
  }, 30);
}

window.openPlanTasks = (pid) => {
  const p = (state.db.plans || []).find(x => x.id === pid); if (!p) return;
  const ts = state.db.tasks.filter(t => t.planId === pid);
  const body = ts.length ? ts.map(t => `<div class="card" style="margin:8px 0"><div class="row" style="justify-content:space-between"><b>${esc(t.title)}</b><span class="chip ${statusChip(t.status)}">${t.status}</span></div>
    <div class="muted" style="font-size:12px">${ownerBadge(t.ownerId)} · ${t.category || "—"} · 截止 ${t.due || "—"} · ${t.progress || 0}%</div>
    <div class="bar"><i style="width:${t.progress || 0}%"></i></div>
    <div class="row" style="margin-top:6px;gap:6px">${canEditTask(t) ? `<button class="btn btn-sm" onclick="openTaskForm('${t.id}')">编辑</button>` : ""}<button class="btn btn-sm" onclick="openTaskDetail('${t.id}')">详情</button></div></div>`).join("")
    : '<div class="empty">该计划下暂无任务</div>';
  openModal("📋 " + p.title + " · 阶段任务", `<div class="muted" style="margin-bottom:8px">负责人 ${ownerBadge(p.ownerId)} · 协助：${(p.collaborators || []).map(c => ownerBadge(c)).join(" ") || "—"} · 进度 ${p.progress || 0}%</div>${body}`);
};

function renderProgress(main) {
  const cols = [
    { s: "todo", l: "待办" }, { s: "doing", l: "进行中" }, { s: "done", l: "已完成" },
  ];
  const q = state.query;
  const cats = ["全部", ...TASK_CATS];
  const catCount = (c) => c === "全部" ? state.db.tasks.length : state.db.tasks.filter(t => t.category === c).length;
  const catTabs = `<div class="row" style="gap:6px;flex-wrap:wrap;margin:12px 0">${cats.map(c =>
    `<button class="btn btn-sm ${taskCatTab === c ? "btn-primary" : ""}" onclick="setTaskCat('${c}')">${c} (${catCount(c)})</button>`).join("")}</div>`;
  main.innerHTML = `<div class="page-head"><div><h2>执行进度</h2><div class="sub">看板式任务流，关联计划与反馈，按分类管理</div></div>
    <button class="btn btn-primary" onclick="openTaskForm()">＋ 新建任务</button></div>
    <div class="muted" style="margin:0 0 4px">任务分类</div>${catTabs}
    <div class="kanban">${cols.map(c => {
      const ts = state.db.tasks.filter(t => t.status === c.s && matches(t, q) && (taskCatTab === "全部" || t.category === taskCatTab));
      return `<div class="kcol"><h4>${c.l}<span class="chip">${ts.length}</span></h4>${ts.map(t => `
        <div class="ktask"><div class="t">${esc(t.title)}</div>
        <div class="m"><b>责任人</b> ${ownerBadge(t.ownerId)}</div>
        <div class="m">${({ 高: "<span class='chip red'>高优先级</span>", 中: "<span class='chip orange'>中优先级</span>", 低: "<span class='chip'>低优先级</span>" }[t.priority] || "")} ${t.category ? `<span class='chip brand'>${esc(t.category)}</span>` : ""} 计划：${esc((state.db.plans.find(p => p.id === t.planId) || {}).title || "—")}</div>
        ${t.desc ? `<div class="m muted" style="font-size:12px;margin:2px 0">${esc(t.desc)}</div>` : ""}
        <div class="m">截止 ${t.due || "—"} ${t.status !== "done" && t.due && t.due < new Date().toISOString().slice(0, 10) ? '<span class="chip red">⚠ 超期</span>' : ""} ${t.ownerId ? "" : '<span class="chip red">⚠ 待指派</span>'}</div>
        <div class="bar"><i style="width:${t.progress || 0}%"></i></div>
        <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px"><button class="btn btn-sm" onclick="cycleTask('${t.id}')">→ 推进</button>
        <button class="btn btn-sm" onclick="openTaskDetail('${t.id}')">详情</button>
        ${t.ownerId !== state.user ? `<button class="btn btn-sm btn-primary" onclick="claimTask('${t.id}')">领取</button>` : ""}
        ${t.ownerId === state.user ? `<button class="btn btn-sm" onclick="openTransferModal('${t.id}')">转让给</button>` : ""}
        <button class="btn btn-sm btn-danger" onclick="del('tasks','${t.id}')">删</button></div></div>`).join("") || "<div class='muted' style='font-size:12px'>空</div>"}</div>`;
    }).join("")}</div>`;
}
window.cycleTask = async (id) => {
  const t = state.db.tasks.find(x => x.id === id); const order = ["todo", "doing", "done"];
  const ns = order[(order.indexOf(t.status) + 1) % 3];
  await api("PUT", `/tasks/${id}`, { status: ns, progress: ns === "done" ? 100 : t.progress });
  toast("已推进到 " + ({ todo: "待办", doing: "进行中", done: "已完成" }[ns]));
};
window.openTaskForm = (id) => {
  const t = id ? state.db.tasks.find(x => x.id === id) : {};
  openModal(id ? "编辑任务" : "新建任务", formHTML([
    { key: "title", label: "任务标题" },
    { key: "planId", label: "所属计划", type: "select", options: state.db.plans.map(p => ({ v: p.id, l: p.title })) },
    { key: "priority", label: "优先级", type: "select", options: [{ v: "高", l: "高" }, { v: "中", l: "中" }, { v: "低", l: "低" }] },
    { key: "category", label: "任务分类", type: "select", options: TASK_CATS.map(c => ({ v: c, l: c })) },
    { key: "status", label: "状态", type: "select", options: [{ v: "todo", l: "待办" }, { v: "doing", l: "进行中" }, { v: "done", l: "已完成" }] },
    { key: "ownerId", label: "负责人（留空＝待领取）", type: "select", options: [{ v: "", l: "— 待领取 —" }, ...state.db.members.map(m => ({ v: m.id, l: m.name }))] },
    { key: "due", label: "截止日期", type: "date" }, { key: "progress", label: "进度(%)", type: "number" },
    { key: "desc", label: "任务说明", type: "textarea" },
  ], t));
  $("#modalBody").insertAdjacentHTML("afterbegin", aiBtn("task", "desc", { hint: "让 AI 帮你起草任务说明与执行要点。" }));
  $("#formSubmit").onclick = async () => {
    const fd = readForm(); if (!fd.title) return toast("请填标题");
    id ? await api("PUT", `/tasks/${id}`, fd) : await api("POST", "/tasks", fd);
    closeModal(); toast("已保存");
  };
};
window.openTaskDetail = (id) => {
  const t = state.db.tasks.find(x => x.id === id); if (!t) return;
  const plan = (state.db.plans.find(p => p.id === t.planId) || {}).title || "—";
  const od = (t.status !== "done" && t.due && t.due < new Date().toISOString().slice(0, 10));
  openModal("任务详情 · " + t.title, `
    <div class='field'><label>所属计划</label><div>${esc(plan)}</div></div>
    <div class='row' style='gap:10px;flex-wrap:wrap'>
      <div class='field' style='flex:1'><label>优先级</label><div>${esc(t.priority || "—")}</div></div>
      <div class='field' style='flex:1'><label>分类</label><div>${t.category ? '<span class="chip brand">' + esc(t.category) + '</span>' : "—"}</div></div>
      <div class='field' style='flex:1'><label>状态</label><div><span class='chip ${statusChip(t.status)}'>${t.status}</span></div></div>
    </div>
    <div class='row' style='gap:10px;flex-wrap:wrap'>
      <div class='field' style='flex:1'><label>负责人</label><div>${t.ownerId ? mName(t.ownerId) : '<span class="chip">待领取</span>'}</div></div>
      <div class='field' style='flex:1'><label>截止</label><div>${esc(t.due || "—")} ${od ? '<span class="chip red">⚠ 超期</span>' : ""}</div></div>
      <div class='field' style='flex:1'><label>进度</label><div>${t.progress || 0}%</div></div>
    </div>
    <div class='field'><label>任务说明</label><div class='doc-body' style='white-space:pre-wrap'>${esc(t.desc || "（暂无说明）")}</div></div>
    <div class='row' style='justify-content:flex-end;margin-top:10px;gap:8px'>
      ${t.ownerId !== state.user ? `<button class='btn btn-primary' onclick='claimTask("${t.id}")'>领取此任务</button>` : ""}
      ${t.ownerId === state.user ? `<button class='btn' onclick='openTransferModal("${t.id}")'>转让给他人</button>` : ""}
      <button class='btn' onclick='openTaskForm("${t.id}")'>编辑</button>
    </div>`);
};
window.claimTask = async (id) => {
  await api("PUT", `/tasks/${id}`, { ownerId: state.user });
  toast("已领取任务");
};
window.claimPlan = async (id) => {
  await api("PUT", `/plans/${id}`, { ownerId: state.user, status: "进行中" });
  toast("已认领计划，状态已置为进行中");
};
window.openTransferModal = (id) => {
  const t = state.db.tasks.find(x => x.id === id); if (!t) return;
  const opts = state.db.members.filter(m => m.id !== state.user).map(m => ({ v: m.id, l: m.name }));
  openModal("转让任务 · " + t.title, formHTML([
    { key: "ownerId", label: "转让给", type: "select", options: opts },
  ], {}) + `<div class='row' style='justify-content:flex-end;margin-top:6px'><button class='btn' onclick='closeModal()'>取消</button><button class='btn btn-primary' id='formSubmit'>确认转让</button></div>`);
  $("#formSubmit").onclick = async () => {
    const fd = readForm(); if (!fd.ownerId) return toast("请选择受让人");
    await api("PUT", `/tasks/${id}`, { ownerId: fd.ownerId });
    toast("已转让给 " + mName(fd.ownerId)); closeModal();
  };
};

let fbSrc = "全部";
function fbTargetOptions(src) {
  if (src === "客户") return custC().map(c => ({ v: c.id, l: c.name }));
  if (src === "门店") return custB().filter(c => c.tier === "门店").map(c => ({ v: c.id, l: c.name }));
  return custB().filter(c => c.tier !== "门店").map(c => ({ v: c.id, l: `${c.name}（${c.tier}）` }));
}
const fbName = (f) => cName(f.targetId || f.customerId);
const fbSrcChip = (s) => ({ "代理": "brand", "门店": "orange", "客户": "green" }[s] || "");
window.setFbSrc = (s) => { fbSrc = s; render(); };

function renderFeedback(main) {
  const all = state.db.feedback.filter(f => matches(f, state.query));
  const bySrc = (s) => all.filter(f => (f.source || "客户") === s);
  const list = fbSrc === "全部" ? all : bySrc(fbSrc);
  const metrics = {};
  list.forEach(f => { if (!metrics[f.metric]) metrics[f.metric] = []; metrics[f.metric].push(Number(f.value) || 0); });
  const chart = Object.entries(metrics).map(([k, vs]) => {
    const avg = (vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(1);
    const max = Math.max(...vs, 1);
    return `<div style="margin:10px 0"><div class="row" style="justify-content:space-between"><b>${esc(k)}</b><span class="muted">均值 ${avg}</span></div>
      <div class="bar"><i style="width:${Math.min(100, avg / max * 100)}%"></i></div></div>`;
  }).join("");
  const tabs = ["全部", "代理", "门店", "客户"].map(s => `<button class="btn btn-sm ${fbSrc === s ? "btn-primary" : ""}" onclick="setFbSrc('${s}')">${s}${s === "全部" ? "" : `（${bySrc(s).length}）`}</button>`).join("");
  main.innerHTML = `<div class="page-head"><div><h2>数据反馈</h2><div class="sub">代理 / 门店 / 客户 三类来源统一反馈，数据互通</div></div>
    <button class="btn btn-primary" onclick="openFeedbackForm()">＋ 录入反馈</button></div>
    <div class="grid cols-3" style="margin-bottom:14px">
      ${kpi("代理反馈", bySrc("代理").length, "🏢")} ${kpi("门店反馈", bySrc("门店").length, "🏬")} ${kpi("客户反馈", bySrc("客户").length, "👥")}
    </div>
    <div class="row" style="gap:8px;margin-bottom:12px">${tabs}</div>
    <div class="grid cols-2"><div class="card"><h3>📊 指标概览${fbSrc !== "全部" ? `（${fbSrc}）` : ""}</h3>${chart || "<div class='muted'>暂无数据</div>"}</div>
    <div class="card"><h3>📋 反馈记录（${list.length}）</h3>
      <table><tr><th>来源</th><th>对象</th><th>指标</th><th>值</th><th>日期</th><th></th></tr>
      ${list.map(f => `<tr><td><span class="chip ${fbSrcChip(f.source)}">${f.source || "客户"}</span></td><td>${fbName(f)}</td><td>${esc(f.metric)}</td><td><b>${esc(f.value)}</b></td><td>${f.date || ""}</td>
      <td><button class="btn btn-sm btn-danger" onclick="del('feedback','${f.id}')">删</button></td></tr>`).join("") || "<tr><td colspan=6 class='muted'>无</td></tr>"}
      </table></div></div>`;
}
window.openFeedbackForm = () => {
  openModal("录入数据反馈", formHTML([
    { key: "source", label: "反馈来源", type: "select", options: [{ v: "代理", l: "代理（省代/市代/区代/合伙人）" }, { v: "门店", l: "门店" }, { v: "客户", l: "客户（C端）" }] },
    { key: "targetId", label: "反馈对象", type: "select", options: fbTargetOptions("代理") },
    { key: "metric", label: "指标名称", placeholder: "如：到店体验人数 / 排便频率" },
    { key: "value", label: "数值" },
    { key: "date", label: "日期", type: "date" },
    { key: "note", label: "说明", type: "textarea" },
    { key: "linkedTaskId", label: "关联任务(可选)", type: "select", options: [{ v: "", l: "无" }, ...state.db.tasks.map(t => ({ v: t.id, l: t.title }))] },
  ], { source: "代理", date: new Date().toISOString().slice(0, 10) }));
  $("#modalBody").insertAdjacentHTML("afterbegin", aiBtn("feedback", "note", { hint: "让 AI 帮你生成数据洞察与说明建议。" }));
  const upd = () => {
    const src = $("#modalBody select[name='source']").value;
    const sel = $("#modalBody select[name='targetId']");
    sel.innerHTML = fbTargetOptions(src).map(o => `<option value="${o.v}">${o.l}</option>`).join("");
  };
  $("#modalBody select[name='source']").onchange = upd;
  $("#formSubmit").onclick = async () => {
    const fd = readForm(); if (!fd.metric) return toast("请填指标");
    fd.source = fd.source || "客户";
    await api("POST", "/feedback", fd); closeModal(); toast("已录入");
  };
};

let custTab = "all";
function custB() { return state.db.customers.filter(c => c.type === "B"); }
function custC() { return state.db.customers.filter(c => c.type === "C"); }
function bDownstream(id) {
  const kids = state.db.customers.filter(c => c.type === "B" && c.parentId === id);
  return kids.concat(...kids.map(k => bDownstream(k.id)));
}
function bCcount(id) {
  const ids = [id, ...bDownstream(id).map(x => x.id)];
  return state.db.customers.filter(c => c.type === "C" && ids.includes(c.sourceBId)).length;
}
function bStoreCount(id) { return bDownstream(id).filter(x => x.tier === "门店").length; }

function renderCustomers(main) {
  const all = state.db.customers.filter(c => matches(c, state.query));
  const tabBtn = (t, l) => `<button class="btn btn-sm ${custTab === t ? "btn-primary" : ""}" onclick="setCustTab('${t}')">${l}</button>`;
  let body = "";
  if (custTab === "all") {
    body = `<div class="card"><h3>🔗 统一路径：渠道 → 用户</h3>
      <div class="muted" style="margin-bottom:8px">所有客户统一管理；B 端渠道（省代/市代/区代/门店/合伙人）带来 C 端用户，数据全互通。</div>
      ${custB().map(b => {
        const chain = []; let p = b; while (p && p.parentId) { p = state.db.customers.find(x => x.id === p.parentId); if (p) chain.unshift(p.name); }
        return `<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin:8px 0">
          <div class="row" style="justify-content:space-between"><b>${esc(b.name)}</b><span class="chip brand">${b.tier}</span></div>
          <div class="muted" style="font-size:12px">${chain.length ? "上级：" + chain.map(esc).join(" → ") : "总部直管"} · ${b.region || ""}</div>
          <div class="row" style="margin-top:6px"><span class="chip">下游门店 ${bStoreCount(b.id)}</span>
          <span class="chip green">带来 C 用户 ${bCcount(b.id)}</span><span class="chip">价值 ${b.level}级</span></div></div>`;
      }).join("")}
    </div>
    <div class="card" style="margin-top:14px"><h3>👥 全部客户（${all.length}）</h3>${custTable(all)}</div>`;
  } else if (custTab === "B") {
    body = `<div class="card"><h3>🏢 B 端客户（渠道/代理，共 ${custB().length}）</h3>${custTable(custB().filter(c => matches(c, state.query)), true)}</div>`;
  } else {
    body = `<div class="card"><h3>🧍 C 端客户（终端用户，共 ${custC().length}）</h3>${custTable(custC().filter(c => matches(c, state.query)), false)}</div>`;
  }
  main.innerHTML = `<div class="page-head"><div><h2>客户系统（B/C 双端 · 统一路径）</h2><div class="sub">B 端=省代/市代/区代/门店/合伙人；C 端=终端用户；统一管理、数据互通</div></div>
    <div class="row"><button class="btn btn-primary" onclick="openCustomerForm()">＋ 新建客户</button></div></div>
    <div class="row" style="margin-bottom:14px">${tabBtn("all", "统一路径")} ${tabBtn("B", "B 端渠道")} ${tabBtn("C", "C 端用户")}</div>${body}`;
}
window.setCustTab = (t) => { custTab = t; render(); };

function custTable(list, isB) {
  if (!list.length) return "<div class='muted'>无匹配客户</div>";
  const h3 = isB === true ? "区域" : isB === false ? "来源渠道" : "区域/来源";
  const rows = list.map(c => {
    if (c.type === "B") {
      return `<tr><td><b>${esc(c.name)}</b><br><span class="muted">${esc(c.contact || "")}</span></td>
        <td><span class="chip brand">${c.tier || "—"}</span></td>
        <td>${esc(c.region || "—")}</td>
        <td><span class="chip ${c.level === "A" ? "green" : c.level === "B" ? "orange" : ""}">${c.level}级</span></td>
        <td>${esc(c.stage || "—")}</td>
        <td class="muted">下游门店 ${bStoreCount(c.id)} · C用户 ${bCcount(c.id)}</td>
        <td><button class="btn btn-sm" onclick="openCustomerDetail('${c.id}')">详情</button>
          <button class="btn btn-sm" onclick="openCustomerForm('${c.id}')">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="del('customers','${c.id}')">删</button></td></tr>`;
    }
    const sb = state.db.customers.find(x => x.id === c.sourceBId);
    return `<tr><td><b>${esc(c.name)}</b><br><span class="muted">${esc(c.contact || "")}</span></td>
      <td><span class="chip">C端</span></td>
      <td>${sb ? esc(sb.name) : "—"}</td>
      <td><span class="chip ${c.level === "A" ? "green" : c.level === "B" ? "orange" : ""}">${c.level}级</span></td>
      <td>${esc(c.stage || "—")}</td>
      <td class="muted">${esc((c.tags || []).join("、") || "—")}</td>
      <td><button class="btn btn-sm" onclick="openCustomerDetail('${c.id}')">详情</button>
        <button class="btn btn-sm" onclick="openCustomerForm('${c.id}')">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="del('customers','${c.id}')">删</button></td></tr>`;
  }).join("");
  return `<table><tr><th>名称</th><th>类型</th><th>${h3}</th><th>价值</th><th>阶段</th><th>关联</th><th></th></tr>${rows}</table>`;
}
window.openCustomerForm = (id) => {
  const c = id ? state.db.customers.find(x => x.id === id) : { type: "B" };
  const bOpts = state.db.customers.filter(x => x.type === "B" && x.id !== id);
  const html = `
    <div class="field"><label>客户类型</label><select name="type" id="cType">
      <option value="B" ${c.type === "B" ? "selected" : ""}>B 端（渠道/代理）</option>
      <option value="C" ${c.type === "C" ? "selected" : ""}>C 端（终端用户）</option></select></div>
    <div class="field"><label>名称</label><input name="name" value="${esc(c.name || "")}" /></div>
    <div class="field"><label>联系方式</label><input name="contact" value="${esc(c.contact || "")}" /></div>
    <div id="bFields" class="${c.type === "C" ? "hidden" : ""}">
      <div class="form-row">
        <div class="field"><label>渠道层级</label><select name="tier">${["省代", "市代", "区代", "门店", "合伙人"].map(t => `<option ${c.tier === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="field"><label>区域</label><input name="region" value="${esc(c.region || "")}" placeholder="省/市/区" /></div>
      </div>
      <div class="field"><label>上级渠道（可不填＝总部直管）</label><select name="parentId"><option value="">— 总部直管 —</option>${bOpts.map(b => `<option value="${b.id}" ${c.parentId === b.id ? "selected" : ""}>${esc(b.name)}（${b.tier}）</option>`).join("")}</select></div>
    </div>
    <div id="cFields" class="${c.type !== "C" ? "hidden" : ""}">
      <div class="field"><label>来源渠道（B 端）</label><select name="sourceBId"><option value="">— 无 —</option>${bOpts.map(b => `<option value="${b.id}" ${c.sourceBId === b.id ? "selected" : ""}>${esc(b.name)}（${b.tier}）</option>`).join("")}</select></div>
    </div>
    <div class="form-row">
      <div class="field"><label>价值分层</label><select name="level">${["A", "B", "C"].map(l => `<option value="${l}" ${c.level === l ? "selected" : ""}>${l} 级</option>`).join("")}</select></div>
      <div class="field"><label>阶段</label><input name="stage" value="${esc(c.stage || "")}" placeholder="合作中/干预中/复购…" /></div>
    </div>
    <div class="field"><label>标签（逗号分隔）</label><input name="tags" value="${esc((c.tags || []).join(", "))}" /></div>
    <div class="field"><label>备注</label><textarea name="notes">${esc(c.notes || "")}</textarea></div>
    <input type="hidden" name="_keep" value="1">
    <div class="row" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-primary" id="formSubmit">保存</button></div>`;
  openModal(id ? "编辑客户" : "新建客户", html);
  $("#modalBody").insertAdjacentHTML("afterbegin", aiBtn("customer", "notes", { hint: "让 AI 帮你生成客户画像与跟进建议。" }));
  $("#cType").onchange = (e) => {
    const t = e.target.value;
    $("#bFields").classList.toggle("hidden", t !== "B");
    $("#cFields").classList.toggle("hidden", t !== "C");
  };
  $("#formSubmit").onclick = async () => {
    const fd = readForm();
    fd.tags = fd.tags ? fd.tags.split(",").map(s => s.trim()).filter(Boolean) : [];
    if (!fd.name) return toast("请填名称");
    if (fd.type === "B") { fd.sourceBId = ""; } else { fd.tier = ""; fd.region = ""; fd.parentId = ""; }
    if (!fd.parentId) fd.parentId = "";
    id ? await api("PUT", `/customers/${id}`, fd) : await api("POST", "/customers", fd);
    closeModal(); toast("已保存");
  };
};

// ---------- 客户详情：随访时间线 + 菌群检测报告 ----------
let custDetailTab = 'info';
function setCustDetail(i, id) { custDetailTab = ['info', 'follow', 'report'][i]; openCustomerDetail(id); }
window.openCustomerDetail = (id) => {
  const c = state.db.customers.find(x => x.id === id); if (!c) return;
  const fus = state.db.followups.filter(f => f.customerId === id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const rps = state.db.reports.filter(r => r.customerId === id);
  const sb = state.db.customers.find(x => x.id === c.sourceBId);
  const pb = state.db.customers.find(x => x.id === c.parentId);
  const tabBtn = (i, l) => `<button class='btn btn-sm ${custDetailTab === ['info', 'follow', 'report'][i] ? 'btn-primary' : ''}' onclick="setCustDetail(${i},'${id}')">${l}</button>`;
  let body = '';
  if (custDetailTab === 'info') {
    body = `<div class='form-row'>
      <div class='field'><label>类型</label><div>${c.type === 'B' ? 'B 端（渠道/代理）' : 'C 端（终端用户）'}</div></div>
      <div class='field'><label>价值分层</label><div><span class='chip ${c.level === 'A' ? 'green' : c.level === 'B' ? 'orange' : ''}'>${c.level} 级</span></div></div></div>
    <div class='form-row'>
      <div class='field'><label>阶段</label><div>${esc(c.stage || '—')}</div></div>
      <div class='field'><label>${c.type === 'B' ? '渠道层级' : '来源渠道'}</label><div>${c.type === 'B' ? esc(c.tier || '—') : (sb ? esc(sb.name) : '—')}</div></div></div>
    ${c.type === 'B' ? `<div class='form-row'><div class='field'><label>区域</label><div>${esc(c.region || '—')}</div></div><div class='field'><label>上级渠道</label><div>${pb ? esc(pb.name) : '总部直管'}</div></div></div><div class='field'><label>下游门店 / 带来 C 用户</label><div><span class='chip'>下游门店 ${bStoreCount(c.id)}</span> <span class='chip green'>C 用户 ${bCcount(c.id)}</span></div></div>` : `<div class='field'><label>联系方式</label><div>${esc(c.contact || '—')}</div></div>`}
    <div class='field'><label>标签</label><div>${(c.tags || []).map(t => `<span class='chip'>${esc(t)}</span>`).join('') || '—'}</div></div>
    <div class='field'><label>备注</label><div class='muted'>${esc(c.notes || '—')}</div></div>`;
  } else if (custDetailTab === 'follow') {
    body = `<div class='row' style='margin-bottom:10px'><button class='btn btn-sm btn-primary' onclick="openFollowForm('${id}')">＋ 新增随访</button></div>
      ${fus.length ? fus.map(f => `<div style='border-left:3px solid var(--brand);padding:6px 12px;margin:8px 0;background:#fafaff'><div class='row' style='justify-content:space-between'><b>${esc(f.type)}</b><span class='muted'>${f.date}</span></div><div class='muted' style='font-size:12px'>${mName(f.byMember)}</div><div style='font-size:13px;margin-top:3px'>${esc(f.content)}</div></div>`).join('') : "<div class='muted'>暂无随访记录，点击上方新增</div>"}`;
  } else {
    body = `<div class='row' style='margin-bottom:10px'><button class='btn btn-sm btn-primary' onclick="openReportForm('${id}')">＋ 新增检测报告</button></div>
      ${rps.length ? rps.map(r => `<div class='card' style='margin:8px 0;box-shadow:none'><div class='row' style='justify-content:space-between'><b>${esc(r.title)}</b><span class='muted'>${r.date}</span></div>
        <table style='margin-top:8px'><tr><th>指标</th><th>数值</th><th>参考</th><th>状态</th></tr>
        ${(r.dimensions || []).map(d => `<tr><td>${esc(d.name)}</td><td>${esc(d.value)}${esc(d.unit || '')}</td><td>${esc(d.ref || '—')}</td><td><span class='chip ${d.status === '正常' ? 'green' : 'red'}'>${esc(d.status || '—')}</span></td></tr>`).join('')}</table></div>`).join('') : "<div class='muted'>暂无检测报告，点击上方新增</div>"}`;
  }
  openModal(esc(c.name) + ' · 详情', `<div class='row' style='margin-bottom:10px'>${tabBtn(0, '基本信息')} ${tabBtn(1, '随访时间线')} ${tabBtn(2, '菌群检测')}</div><div>${body}</div>
    <div class='row' style='justify-content:flex-end;margin-top:14px'><button class='btn' onclick="openCustomerForm('${id}')">编辑客户</button><button class='btn btn-primary' onclick="closeModal()">关闭</button></div>`);
};
window.openFollowForm = (cid) => {
  openModal('新增随访', formHTML([
    { key: 'date', label: '日期', type: 'date' },
    { key: 'type', label: '类型', placeholder: '首访解读 / 第2周回访 / 复测…' },
    { key: 'byMember', label: '跟进人', type: 'select', options: state.db.members.map(m => ({ v: m.id, l: m.name })) },
    { key: 'content', label: '内容', type: 'textarea' },
  ], { date: new Date().toISOString().slice(0, 10) }));
  $('#modalBody').insertAdjacentHTML('afterbegin', aiBtn('followup', 'content', { hint: '让 AI 帮你起草随访记录与话术要点。' }));
  $('#formSubmit').onclick = async () => {
    const fd = readForm(); if (!fd.content) return toast('请填写随访内容');
    const item = await api('POST', '/followups', { customerId: cid, ...fd });
    state.db.followups.push(item);
    closeModal(); openCustomerDetail(cid); toast('已添加随访');
  };
};
window.openReportForm = (cid) => {
  openModal('新增菌群检测报告', formHTML([
    { key: 'title', label: '报告标题', placeholder: '如：基线菌群检测报告' },
    { key: 'date', label: '日期', type: 'date' },
    { key: 'dimRaw', label: '指标维度（每行一项：名称,值,单位,参考,状态）', type: 'textarea', placeholder: '菌群多样性(Shannon),3.1,,≥3.8,偏低\n厚壁菌/拟杆菌比(F/B),1.6,,0.8-1.2,偏高' },
  ], { date: new Date().toISOString().slice(0, 10) }));
  $('#modalBody').insertAdjacentHTML('afterbegin', aiBtn('report', 'dimRaw', { titleField: 'title', hint: '让 AI 帮你生成一份标准菌群检测指标维度（可直接保存）。' }));
  $('#formSubmit').onclick = async () => {
    const fd = readForm(); if (!fd.title) return toast('请填报告标题');
    const dimensions = (fd.dimRaw || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
      const [name, value, unit, ref, status] = line.split(',').map(x => (x || '').trim());
      return { name, value, unit, ref, status: status || '正常' };
    });
    const item = await api('POST', '/reports', { customerId: cid, title: fd.title, date: fd.date, dimensions });
    state.db.reports.push(item);
    closeModal(); openCustomerDetail(cid); toast('已添加检测报告');
  };
};

function renderTeam(main) {
  buildChatRooms();
  const activeRoom = chatRooms.find(r => r.id === chatRoom) || chatRooms[0];
  main.innerHTML = `<div class="page-head"><div><h2>团队</h2><div class="sub">参与项目的成员（多人实时协作 + 群聊/私聊）</div></div>
    <div class="row"><button class="btn btn-primary" onclick="openMemberForm()">＋ 添加成员</button>
    <button class="btn" onclick="openInvite()">🔗 邀请 WorkBuddy 用户</button></div></div>

    <!-- 聊天面板 -->
    <div class="card" style="margin-bottom:16px"><h3>💬 团队聊天（实时同步 · 支持私聊 / 拉群 / 任务共享编辑）</h3>
      <div class="chat-layout">
        <div class="chat-sidebar">
          <div class="chat-sidebar-head row" style="justify-content:space-between">会话 <button class="btn btn-sm" style="padding:2px 8px" onclick="openGroupForm()" title="拉一个小组群">＋ 拉群</button></div>
          ${chatRooms.map(r => `<div class="chat-session ${r.id === chatRoom ? 'active' : ''}" onclick="switchChatRoom('${r.id}')">
            <span>${r.icon}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${esc(r.name)}</span>
            ${r.custom ? `<button class="btn btn-sm btn-danger" style="padding:0 6px;font-size:11px" title="${r.ownerId === state.user ? '解散群' : '退出(群主才可解散)'}" onclick="event.stopPropagation();dissolveGroup('${r.id}')">✕</button>` : ""}
          </div>`).join("")}
        </div>
        <div class="chat-main">
          <div class="chat-header"><img src='mascot-head.png' class='mascot-sm'> ${esc(activeRoom?.name || "聊天")}${activeRoom?.members ? `<span class="muted" style="font-size:12px">（${activeRoom.members.length} 人 · ${activeRoom.members.map(id => mName(id)).join("、")}）</span>` : ""}</div>
          <div class="chat-messages" id="chatMsgBox"></div>
          <div class="chat-input-row">
            <textarea id="chatInput" placeholder="输入消息…（支持 @任务 共享编辑 / AI 协助）" rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat()}"></textarea>
            <div class="chat-actions">
              <button class="btn btn-sm" title="引用任务（对方点开即可编辑）" onclick="chatInsertTask()">📌 任务</button>
              <button class="btn btn-sm" title="AI 协助写消息" onclick="chatAIAssist()">🤖 AI</button>
              <button class="btn btn-primary btn-sm" onclick="sendChat()">发送</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 工作负载 -->
    <h3 style="margin:4px 0 10px">📊 成员工作负载</h3>
    <div class="grid cols-3" id="teamWorkload"></div>

    <!-- 成员列表 -->
    <h3 style="margin:14px 0 10px">👥 成员列表</h3>
    <div class="grid cols-3" id="teamMemberList"></div>`;
  setTimeout(() => {
    const listEl = $("#teamMemberList");
    if (listEl) {
      listEl.innerHTML = state.db.members.filter(m => matches(m, state.query)).map(m => {
        const dmId = "dm_" + [state.user, m.id].sort().join("_");
        const username = m.id.replace(/^m_/, "");
        return `<div class="card" style="display:flex;gap:12px;align-items:center"><img src='mascot-head.png' class='mascot-img'>
        <div><b>${esc(m.name)}</b><div class="muted">${esc(m.role)}</div>
        <div class="row" style="margin-top:6px;flex-wrap:wrap"><button class="btn btn-sm" onclick="openMemberForm('${m.id}')">编辑</button>
        <button class="btn btn-sm" onclick="switchChatRoom('${dmId}')">💬 私聊</button>
        ${state.role === "admin" && m.id !== state.user ? `<button class="btn btn-sm" style="background:#b8860b;color:#fff;border-color:#b8860b" title="把 ${esc(username)} 的登录账号提升为管理员" onclick="setMemberAdmin('${m.id}')">👑 设为管理员</button>` : ""}
        <button class="btn btn-sm btn-danger" onclick="del('members','${m.id}')">移除</button></div></div></div>`;
      }).join("");
    }
    const wlEl = $("#teamWorkload");
    if (wlEl) {
      wlEl.innerHTML = state.db.members.filter(m => matches(m, state.query)).map(m => {
        const owned = state.db.plans.filter(p => p.ownerId === m.id).length;
        const collab = state.db.plans.filter(p => (p.collaborators || []).includes(m.id)).length;
        const tasks = state.db.tasks.filter(t => t.ownerId === m.id).length;
        const doing = state.db.tasks.filter(t => t.ownerId === m.id && t.status !== "done").length;
        return `<div class="card wl-card"><div class="row" style="gap:10px;align-items:center"><img src='mascot-head.png' class='mascot-img'><div><b>${esc(m.name)}</b><div class="muted" style="font-size:12px">${esc(m.role)}</div></div></div>
          <div class="wl-stats"><div><b>${owned}</b><span>负责计划</span></div><div><b>${collab}</b><span>协助计划</span></div><div><b>${tasks}</b><span>负责任务</span></div><div><b>${doing}</b><span>进行中</span></div></div>
          <button class="btn btn-sm" style="margin-top:8px" onclick="openMemberWorkload('${m.id}')">查看工作计划与负责事项 →</button></div>`;
      }).join("");
    }
    renderChatMessages();
  }, 20);
}
window.openMemberWorkload = (mid) => {
  const m = state.db.members.find(x => x.id === mid); if (!m) return;
  const owned = state.db.plans.filter(p => p.ownerId === mid);
  const collab = state.db.plans.filter(p => (p.collaborators || []).includes(mid));
  const tasks = state.db.tasks.filter(t => t.ownerId === mid);
  const planHTML = (p) => `<div class="card" style="margin:6px 0"><div class="row" style="justify-content:space-between"><b>${esc(p.title)}</b><span class="chip ${statusChip(p.status)}">${p.status}</span></div>
    <div class="muted" style="font-size:12px">${(p.ownerId === mid) ? "负责" : "协助"} · 进度 ${p.progress || 0}% · ${ownerBadge(p.ownerId)} ${(p.collaborators || []).map(c => ownerBadge(c)).join(" ")}</div>
    <div class="bar"><i style="width:${p.progress || 0}%"></i></div></div>`;
  const taskHTML = (t) => `<div class="card" style="margin:6px 0"><div class="row" style="justify-content:space-between"><b>${esc(t.title)}</b><span class="chip ${statusChip(t.status)}">${t.status}</span></div>
    <div class="muted" style="font-size:12px">${t.category || "—"} · 截止 ${t.due || "—"} · ${t.progress || 0}% · 计划 ${esc((state.db.plans.find(p => p.id === t.planId) || {}).title || "—")}</div>
    <div class="bar"><i style="width:${t.progress || 0}%"></i></div></div>`;
  openModal("📊 " + m.name + " · 工作计划与负责事项", `
    <div class="sub">负责计划 ${owned.length} · 协助计划 ${collab.length} · 负责任务 ${tasks.length}</div>
    <h4 style="margin:10px 0 4px">负责 / 协助的计划</h4>
    ${[...owned, ...collab].map(planHTML).join("") || '<div class="empty">暂无计划</div>'}
    <h4 style="margin:10px 0 4px">负责的任务</h4>
    ${tasks.map(taskHTML).join("") || '<div class="empty">暂无任务</div>'}`);
};
window.openInvite = () => {
  const link = location.origin + "/?join=1";
  openModal("邀请成员加入协作", `<p class="muted">把下面链接发给<b>其他 WorkBuddy 用户</b>，他们打开后填写身份即可作为协作成员加入，所有改动通过后端<b>实时同步</b>。</p>
    <div class="share-box"><code>${link}</code></div>
    <div class="row" style="margin-top:12px"><button class="btn btn-primary" id="copyInv">📋 复制邀请链接</button></div>`);
  $("#copyInv").onclick = () => { navigator.clipboard.writeText(link); toast("邀请链接已复制，去 WorkBuddy 发给队友"); };
};
// ---------- 成员提权为管理员 ----------
window.setMemberAdmin = async (mid) => {
  const m = state.db.members.find(x => x.id === mid); if (!m) return;
  const username = mid.replace(/^m_/, "");
  if (!confirm(`确定把「${m.name}」设为管理员？\n对方用账号名「${username}」登录后将拥有全部操作权限（删除成员、审批、全库编辑）。`)) return;
  try {
    const r = await api("POST", "/admin/set-role", { username, role: "admin" });
    toast(`✅ ${m.name}（账号 ${username}）已设为管理员${r.created ? "（已自动建号）" : ""}，对方重新登录后生效`);
  } catch (e) {
    toast(e.message === "read-only" ? "无权限：仅管理员可设置" : "提权失败：" + (e.message || ""));
  }
};
// ---------- 收件箱 / 推送 / 改名 / 导出专项任务 ----------
async function refreshInbox() {
  try { const d = await api("GET", "/inbox"); state.inbox = d.list || []; state.inboxUnread = d.unread || 0; renderAuthBadge(); } catch (e) {}
}
window.markReadSilent = async (id) => {
  try { await api("POST", `/inbox/${id}/read`); state.inboxUnread = Math.max(0, state.inboxUnread - 1); renderAuthBadge(); } catch (e) {}
};
window.markRead = async (id) => {
  try { await api("POST", `/inbox/${id}/read`); openInbox(); } catch (e) {}
};
window.openShared = (col, id, shareId) => {
  markReadSilent(shareId);
  window.open(location.origin + "/?open=" + col + "/" + id, "_blank");
};
function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
window.saveAsTask = async (col, id, title) => {
  try {
    const item = await api("GET", `/${col}/${id}`);
    const openLink = location.origin + "/?open=" + col + "/" + id;
    const body = item.content || item.body || item.desc || item.text || JSON.stringify(item, null, 2);
    const md = `# ${title || item.title || item.name || "专项任务"}\n\n> 由「乔本·数果 AI 协作工作台」推送 · 类型：${col}\n> 源链接：${openLink}\n> 导出时间：${new Date().toISOString()}\n\n本条目已作为专项任务导出，可导入你自己的 WorkBuddy，用你的 AI 能力继续修改：\n\n${body}\n\n\`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\`\n`;
    const json = JSON.stringify({ _source: "qiaoben-shuguo-ai", collection: col, title: title || item.title || item.name, openLink, exportedAt: new Date().toISOString(), item }, null, 2);
    const safe = (title || col).replace(/[\\/?%*:|\"<>]/g, "_").slice(0, 40);
    downloadText(safe + ".md", md, "text/markdown");
    setTimeout(() => downloadText(safe + ".json", json, "application/json"), 400);
    toast("已导出 .md / .json，可导入你自己的 WorkBuddy");
  } catch (e) { toast("导出失败：" + e.message); }
};
window.openInbox = async () => {
  let data;
  try { data = await api("GET", "/inbox"); } catch (e) { data = { list: [], unread: 0 }; }
  state.inbox = data.list || []; state.inboxUnread = data.unread || 0; renderAuthBadge();
  if (!state.inbox.length) return toast("收件箱为空");
  const items = state.inbox.map(s => {
    const t = new Date(s.createdAt).toLocaleString();
    return `<div class="inbox-item ${s.status === 'unread' ? 'unread' : ''}">
      <div class="row" style="justify-content:space-between"><b>${esc(s.title)}</b><span class="muted" style="font-size:12px">${t}</span></div>
      <div class="muted" style="font-size:12px">来自 @${esc(s.fromUsername)}${s.note ? " · " + esc(s.note) : ""}</div>
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
        <button class="btn btn-sm btn-primary" onclick="openShared('${s.collection}','${s.itemId}','${s.id}')">打开</button>
        <button class="btn btn-sm" onclick="saveAsTask('${s.collection}','${s.itemId}','${esc(String(s.title).replace(/'/g, "\\'"))}')">💾 保存为专项任务</button>
        ${s.status === 'unread' ? `<button class="btn btn-sm" onclick="markRead('${s.id}')">标记已读</button>` : ""}
      </div></div>`;
  }).join("");
  openModal("📥 收件箱 (" + state.inboxUnread + " 未读)", `<div class="inbox-list">${items}</div>`);
};
window.openLinkedItem = async (col, id) => {
  try {
    const item = await api("GET", `/${col}/${id}`);
    const body = item.content || item.body || item.desc || item.text || JSON.stringify(item, null, 2);
    openModal(esc(item.title || item.name || "条目详情"), `<div class="doc-body" style="white-space:pre-wrap">${esc(body)}</div>`);
  } catch (e) { toast("打开失败：" + e.message); }
};
window.openRename = () => {
  const approved = state.canEdit;
  const title = approved ? "✏️ 修改名字" : "✏️ 修改名字并提交申请";
  const note = approved
    ? `<p class="muted">显示名可随时改；改 WorkBuddy 名字（身份）会同步重命名你的历史贡献归属。</p>`
    : `<p class="muted">你当前为<b>只读（未审批）</b>状态，不能删除 / 编辑 / 下载 / 转发 / 推送。修改名字并点击下方「提交申请」即向管理员申请操作权限，审批通过后将解锁全部操作。</p>`;
  const btnLabel = approved ? "保存" : "提交申请";
  openModal(title, `${note}
    <div class="field"><label>当前 WorkBuddy 名字</label><div class="muted">@${esc(state.authUser)}</div></div>
    <div class="field"><label>新显示名（可选）</label><input id="rnDisplay" class="login-input" value="${esc(state.authUser)}" placeholder="显示名"></div>
    <div class="field"><label>新 WorkBuddy 名字（可选，身份）</label><input id="rnName" class="login-input" placeholder="如：beau2"></div>
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-primary" id="rnGo">${btnLabel}</button></div>`);
  $("#rnGo").onclick = async () => {
    const displayName = ($("#rnDisplay").value || "").trim();
    const newUsername = ($("#rnName").value || "").trim();
    if (!displayName && !newUsername) return closeModal();
    try {
      const d = await api("POST", "/me/rename", { displayName, newUsername });
      applyAuth(d);
      closeModal();
      toast(approved ? ("已更新：" + (d.changedName ? "身份 @" + d.user : "显示名 " + d.displayName)) : "已提交申请，等待管理员审批（当前仍为只读）");
    } catch (e) {}
  };
};
window.openPushCenter = () => {
  const PUSHABLE = ["plans", "tasks", "proposals", "customers", "docs", "media", "experts", "tools", "aiTasks", "followups", "reports", "feedback"];
  const colOpts = PUSHABLE.map(c => `<option value="${c}">${c}</option>`).join("");
  const userOpts = (state.db.users || []).filter(u => u.username !== state.authUser).map(u => `<label class="chk"><input type="checkbox" value="${esc(u.username)}"> ${esc(u.displayName || u.username)} <span class="muted">@${esc(u.username)}</span></label>`).join("");
  openModal("📤 推送条目给成员", `
    <div class="field"><label>选择条目类型</label><select id="pcCol" class="login-input">${colOpts}</select></div>
    <div class="field"><label>选择条目</label><select id="pcItem" class="login-input"></select></div>
    <div class="field"><label>接收成员</label><div class="chk-list">${userOpts || '<span class="muted">暂无其他成员</span>'}</div></div>
    <div class="field"><label>附言（可选）</label><input id="pcNote" class="login-input" placeholder="例如：请协助完善该方案"></div>
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-primary" id="pcGo">推送</button></div>`);
  const fillItems = () => {
    const c = $("#pcCol").value;
    const items = state.db[c] || [];
    $("#pcItem").innerHTML = items.map(it => `<option value="${it.id}">${esc(it.title || it.name || it.id)}</option>`).join("");
  };
  $("#pcCol").onchange = fillItems; fillItems();
  $("#pcGo").onclick = async () => {
    const c = $("#pcCol").value, id = $("#pcItem").value;
    const sel = [...document.querySelectorAll(".chk-list input:checked")].map(x => x.value);
    if (!id) return toast("请选择条目"); if (!sel.length) return toast("请选择接收成员");
    const note = ($("#pcNote").value || "").trim();
    try { const d = await api("POST", "/push", { collection: c, id, toUsernames: sel, note }); toast(`已推送给 ${d.count} 位成员`); closeModal(); }
    catch (e) {}
  };
};

window.openMemberForm = (id) => {
  const m = id ? state.db.members.find(x => x.id === id) : {};
  openModal(id ? "编辑成员" : "添加成员", formHTML([
    { key: "name", label: "姓名" }, { key: "role", label: "角色" },
    { key: "color", label: "头像色", type: "text", placeholder: "#7c5cff" },
  ], m));
  $("#formSubmit").onclick = async () => {
    const fd = readForm(); if (!fd.name) return toast("请填姓名");
    id ? await api("PUT", `/members/${id}`, fd) : await api("POST", "/members", fd);
    closeModal(); toast("已保存");
  };
};

// ---------- 协作与分工 ----------
function renderCollab(main) {
  const members = state.db.members;
  const today = new Date().toISOString().slice(0, 10);
  const load = (m) => {
    const plans = state.db.plans.filter(p => p.ownerId === m.id);
    const tasks = state.db.tasks.filter(t => t.ownerId === m.id);
    const proposals = state.db.proposals.filter(p => p.createdBy === m.id);
    const ai = state.db.aiTasks.filter(a => a.createdBy === m.id);
    const doing = tasks.filter(t => t.status === "doing").length;
    const todo = tasks.filter(t => t.status === "todo").length;
    const done = tasks.filter(t => t.status === "done").length;
    const overdue = tasks.filter(t => t.status !== "done" && t.due && t.due < today).length;
    const active = doing + todo + proposals.length + ai.length;
    const score = active + plans.length;
    return { plans, tasks, proposals, ai, doing, todo, done, overdue, active, score };
  };
  const loads = members.map(m => ({ m, ...load(m) }));
  const maxScore = Math.max(1, ...loads.map(l => l.score));
  const avg = loads.reduce((a, l) => a + l.score, 0) / loads.length;
  const card = (l) => {
    const overload = l.score > avg && l.score >= 4;
    return `<div class="card"><div class="row" style="gap:12px;align-items:center">
      <div class="av" style="width:40px;height:40px;border-radius:50%;background:${l.m.color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700">${esc(l.m.name[0])}</div>
      <div><b>${esc(l.m.name)}</b><div class="muted" style="font-size:12px">${esc(l.m.role || "")}</div></div>
      ${overload ? `<span class="chip red" style="margin-left:auto">⚠ 负载偏高</span>` : ""}
      ${l.overdue ? `<span class="chip red">⚠ 超期 ${l.overdue}</span>` : ""}
    </div>
    <div class="row" style="gap:6px;margin:8px 0;flex-wrap:wrap">
      <span class="chip">计划 ${l.plans.length}</span><span class="chip orange">进行中 ${l.doing}</span><span class="chip brand">待办 ${l.todo}</span><span class="chip green">已完成 ${l.done}</span><span class="chip">方案 ${l.proposals.length}</span><span class="chip">AI ${l.ai.length}</span>
    </div>
    <div class="bar"><i style="width:${l.score / maxScore * 100}%"></i></div><div class="meta">工作负载 ${l.score}</div></div>`;
  };
  const reassignSel = (col, id, field, cur) => `<select onchange="reassignItem('${col}','${id}','${field}', this.value)" style="max-width:120px">${members.map(mm => `<option value="${mm.id}" ${mm.id === cur ? "selected" : ""}>${esc(mm.name)}</option>`).join("")}</select>`;
  const itemRow = (icon, title, sub, col, id, field, cur) => `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line)">
      <div><b>${esc(title)}</b> <span class="chip brand">${icon}</span>${sub ? `<div class="muted" style="font-size:12px">${sub}</div>` : ""}</div>
      ${reassignSel(col, id, field, cur)}</div>`;
  const board = loads.map(l => {
    const ts = l.tasks.map(t => { const plan = state.db.plans.find(p => p.id === t.planId); const od = (t.status !== "done" && t.due && t.due < today); return itemRow("任务", t.title, `${t.category ? esc(t.category) : "未分类"} · ${plan ? esc(plan.title) : "—"} · 截止 ${t.due || "—"}${od ? " · ⚠超期" : ""}`, "tasks", t.id, "ownerId", l.m.id); });
    const ps = l.proposals.map(p => itemRow("方案", p.title, `状态 ${p.status || "—"}`, "proposals", p.id, "createdBy", l.m.id));
    const as = l.ai.map(a => itemRow("AI", a.title, `状态 ${a.status || "—"}`, "aiTasks", a.id, "createdBy", l.m.id));
    const all = [...ts, ...ps, ...as];
    return `<div class="card"><h3>${esc(l.m.name)}（${all.length}）</h3>${all.join("") || "<div class='muted'>暂无分工</div>"}</div>`;
  }).join("");
  main.innerHTML = `<div class="page-head"><div><h2>协作与分工</h2><div class="sub">按成员视角看「谁负责什么」，任务/方案/AI 均可一键改派，超期与负载偏高自动预警</div></div></div>
    <h3 style="margin:4px 0 10px">👥 成员工作负载</h3>
    <div class="grid cols-3">${loads.map(card).join("")}</div>
    <h3 style="margin:18px 0 10px">🧩 分工看板（右侧下拉可一键改派）</h3>
    <div class="grid cols-2">${board}</div>`;
}
window.reassignItem = async (col, id, field, newOwner) => {
  if (!newOwner) return;
  await api("PUT", `/${col}/${id}`, { [field]: newOwner });
  toast("已改派"); render();
};

function renderResources(main) {
  const ex = state.db.experts.filter(e => matches(e, state.query));
  const tl = state.db.tools.filter(t => matches(t, state.query));
  main.innerHTML = `<div class="page-head"><div><h2>专家与工具</h2><div class="sub">沉淀专业能力，关联 AI 任务，选择专家技能连接器</div></div>
    <div class="row"><button class="btn btn-primary" onclick="openExpertForm()">＋ 专家</button>
    <button class="btn" onclick="openToolForm()">＋ 工具</button></div></div>
    <h3 style="margin:6px 0">🧑‍⚕️ 专家（点击选择关联到工具）</h3>
    <div class="grid cols-3">${ex.map(e => {
      const butlerCount = e.pipeline === "gut-butler" ? state.db.media.filter(m => m.butler).length : 0;
      return `<div class="card" style="cursor:pointer" onclick="selectExpertForTool('${e.id}')">
      <div class="row" style="gap:10px;align-items:center"><img src='mascot-head.png' class='mascot-img' style="background:${e.color}20"><b>${esc(e.name)}</b>${e.pipeline ? '<span class="chip green butler-chip">⚡ 自动干活中</span>' : ""}</div>
      <div class="chip brand" style="margin-top:8px">${esc(e.domain)}</div><div class="muted" style="margin-top:6px">${esc(e.desc)}</div>
      ${e.pipeline === "gut-butler" ? `<div class="muted" style="margin-top:8px;font-size:12px">已累计产出 ${butlerCount} 篇文章素材（每日自动 +1）</div>
        <button class="btn btn-sm btn-primary" style="margin-top:8px" onclick="event.stopPropagation();runGutButler()">▶ 立即产出素材</button>` : '<div class="muted" style="margin-top:8px;font-size:11.5px">点击将此专家关联到工具 →</div>'}
      <button class="btn btn-sm btn-danger" style="margin-top:8px" onclick="event.stopPropagation();del('experts','${e.id}')">移除</button></div>`;
    }).join("") || "<div class='muted'>暂无专家，点击上方添加</div>"}</div>
    <h3 style="margin:16px 0 6px">🧰 工具（已打通专家技能连接器）</h3>
    <div class="grid cols-3">${tl.map(t => {
      const ex = state.db.experts.find(e => e.id === t.expertId);
      return `<div class="card"><div class="row" style="justify-content:space-between"><h3>${esc(t.name)}</h3>${t.connected ? '<span class="chip green">✅ 已连通</span>' : '<span class="chip red">⚠ 未连通</span>'}</div>
      <span class="chip">${esc(t.category)}</span><div class="muted" style="margin-top:6px">${esc(t.desc)}</div>
      <div class='meta' style='margin-top:6px'>
        ${ex ? `<span class='chip brand'>🧑‍⚕️ ${esc(ex.name)}</span>` : `<button class='btn btn-sm' onclick='openExpertPicker("${t.id}")'>🔗 选择专家连接器 →</button>`}
        技能：${esc(t.skill || "—")}
      </div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px">
        ${t.connected ? `<button class="btn btn-sm btn-primary" onclick="invokeTool('${t.id}')">⚡ 调用</button>` : `<button class="btn btn-sm btn-primary" onclick="connectTool('${t.id}')">🔌 打通连接器</button>`}
        <button class="btn btn-sm" onclick="openToolForm('${t.id}')">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="del('tools','${t.id}')">移除</button></div></div>`;
    }).join("") || "<div class='muted'>暂无</div>"}</div>`;
}
window.openExpertForm = () => {
  openModal("添加专家", formHTML([{ key: "name", label: "姓名" }, { key: "domain", label: "领域" }, { key: "desc", label: "简介", type: "textarea" }, { key: "color", label: "头像色", placeholder: "#1e9e6a" }], {}));
  $("#formSubmit").onclick = async () => { const fd = readForm(); if (!fd.name) return toast("请填姓名"); await api("POST", "/experts", fd); closeModal(); toast("已添加"); };
};
window.openToolForm = (id) => {
  const t = id ? state.db.tools.find(x => x.id === id) : {};
  openModal(id ? "编辑工具" : "添加工具", formHTML([
    { key: "name", label: "名称" },
    { key: "category", label: "类别" },
    { key: "desc", label: "说明", type: "textarea" },
    { key: "skill", label: "专家技能", placeholder: "如：菌群报告解读" },
    { key: "connectorId", label: "技能连接器", placeholder: "如：报告解读连接器" },
    { key: "expertId", label: "关联专家", type: "select", options: [{ v: "", l: "无" }, ...state.db.experts.map(e => ({ v: e.id, l: e.name }))] },
    { key: "link", label: "链接(可选)" },
  ], t) + `<label style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:13px"><input type="checkbox" name="connected" ${t.connected ? "checked" : ""}/> 已打通（连接）专家技能连接器</label>`);
  $("#formSubmit").onclick = async () => {
    const fd = readForm(); if (!fd.name) return toast("请填名称");
    fd.connected = !!$("#modalBody input[name=connected]").checked;
    id ? await api("PUT", `/tools/${id}`, fd) : await api("POST", "/tools", fd); closeModal(); toast("已保存");
  };
};
// 专家连接器选择页面
window.openExpertPicker = (toolId) => {
  const t = state.db.tools.find(x => x.id === toolId); if (!t) return;
  const exs = state.db.experts;
  openModal("🔗 选择专家连接器 · " + esc(t.name), `<div class="muted" style="margin-bottom:12px">选择一位专家关联到此工具，调用时将使用该专家的技能与领域知识。</div>
    <div class="grid cols-2">${exs.length ? exs.map(e => `<div class='card' style='cursor:pointer;border:2px solid ${t.expertId===e.id?"var(--brand)":"transparent"};transition:border-color .15s' onclick='pickExpert("${toolId}","${e.id}")'>
      <div class='row' style='gap:10px;align-items:center'><img src='mascot-head.png' class='mascot-img' style="background:${e.color}20"><div><b>${esc(e.name)}</b><div class='chip brand'>${esc(e.domain)}</div></div></div>
      <div class='muted' style='margin-top:6px'>${esc(e.desc)}</div>
      ${t.expertId === e.id ? '<div class="chip green" style="margin-top:6px">✅ 当前已选</div>' : ''}
    </div>`).join("") : "<div class='muted'>暂无专家，请先添加专家</div>"}</div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" onclick="closeModal()">取消</button></div>`);
};
window.pickExpert = async (toolId, expertId) => {
  await api("PUT", `/tools/${toolId}`, { expertId, connected: true });
  toast("已关联专家：" + state.db.experts.find(e => e.id === expertId)?.name);
  closeModal(); render();
};
window.selectExpertForTool = (expertId) => {
  const toolsWithoutExpert = state.db.tools.filter(t => !t.expertId || t.expertId !== expertId);
  if (!toolsWithoutExpert.length) return toast("所有工具都已关联专家");
  openModal("将「" + esc(state.db.experts.find(e => e.id === expertId)?.name || "") + "」关联到工具",
    `<div class="muted" style="margin-bottom:10px">选择一个工具关联此专家：</div>
    ${toolsWithoutExpert.map(t => `<div style='padding:8px;border:1px solid var(--line);border-radius:8px;margin:6px 0;cursor:pointer;display:flex;justify-content:space-between;align-items:center' onclick='pickExpert("${t.id}","${expertId}")'>
      <div><b>${esc(t.name)}</b><div class='muted'>${esc(t.category)} · ${esc(t.skill || "—")}</div></div>
      ${t.expertId ? `<span class='chip'>当前：${esc(state.db.experts.find(e=>e.id===t.expertId)?.name||"—")}</span>` : '<span class="chip red">未关联</span>'}
    </div>`).join("")}`);
};
window.connectTool = async (id) => {
  await api("PUT", `/tools/${id}`, { connected: true });
  toast("已标记为打通技能连接器（实际连接需在 WorkBuddy 平台信任该连接器）");
};
window.invokeTool = async (id) => {
  const t = state.db.tools.find(x => x.id === id);
  if (t.pipeline === "gut-butler") return runGutButler();
  if (t.pipeline === "sugoo-video") return openSugooVideo();
  const a = await api("POST", "/aiTasks", { title: "调用工具：" + t.name, prompt: `请使用【${t.name}】（专家技能：${t.skill || "—"}）完成任务：\n${t.desc || ""}`, linkedType: "task", linkedId: "", status: "待处理" });
  await runAITask(a.id);
  toast("已直通主对话，复制指令交给斜杠喵即可执行");
};
// ---------- 肠道管家：立即产出文章素材 ----------
window.runGutButler = async () => {
  toast("🦠 肠道管家正在检索肠道健康主题并改稿成乔本风格…");
  try {
    const r = await api("POST", "/ai/gut-butler/run");
    const m = r.media || {};
    openModal("🦠 肠道管家 · 文章素材已产出", `
      <div class="row" style="gap:10px;align-items:center;margin-bottom:8px"><span class="chip green">✅ 已写入文章库</span><span class="chip">今日第 ${r.todayCount} 篇</span></div>
      <b style="font-size:15px">${esc(m.title || "")}</b>
      ${m.url ? `<img src="${esc(m.url)}" style="width:100%;border-radius:10px;margin:10px 0;border:1px solid var(--line)">` : ""}
      <div class="doc-body" style="white-space:pre-wrap;max-height:40vh;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:12px;background:#fafbff;font-size:13px">${esc(m.content || "")}</div>
      <div class="muted" style="margin-top:8px;font-size:12px">配图由 AI 自动生成（无版权风险）；发布前建议经「内容合规审核」专家把关。</div>
      <div class="row" style="justify-content:flex-end;margin-top:12px">
        <button class="btn btn-primary" onclick="closeModal();goto('media')">查看文章库 →</button>
        <button class="btn" onclick="runGutButler();closeModal()">再产一篇</button>
      </div>`);
  } catch (e) { toast("产出失败：" + (e.message || "")); }
};
// ---------- AI 短视频生成：数果智能体小程序 / 数果网页版 ----------
const SUGOO_MINI_LINK = "#小程序://数果AI/KtEnuE9yVBolSWu";
const SUGOO_WEB_LINK = "https://sugoo.asia/zh";
window.copySugooLink = async () => {
  try { await navigator.clipboard.writeText(SUGOO_MINI_LINK); toast("已复制小程序链接，到微信任意聊天框粘贴即可打开"); }
  catch { const ta = document.createElement("textarea"); ta.value = SUGOO_MINI_LINK; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("已复制小程序链接，到微信任意聊天框粘贴即可打开"); }
};
window.openSugooVideo = () => {
  openModal("🎬 AI 短视频生成", `
    <div class="muted" style="margin-bottom:12px">用文章库素材一键生成短视频口播脚本与成片，两个入口任选：</div>
    <div class="sv-grid">
      <div class="card sv-card">
        <div class="sv-ic">📱</div>
        <b>数果智能体小程序</b>
        <div class="muted" style="margin:6px 0;font-size:12.5px">微信内使用，体验完整 AI 能力</div>
        <div class="sv-linkbox" onclick="copySugooLink()" title="点击复制">${esc(SUGOO_MINI_LINK)}</div>
        <button class="btn btn-primary" style="margin-top:8px" onclick="copySugooLink()">📋 复制小程序链接</button>
        <div class="muted" style="margin-top:8px;font-size:12px">复制后打开微信，粘贴到任意聊天框（或文件传输助手），点击即可进入小程序</div>
      </div>
      <div class="card sv-card">
        <div class="sv-ic">🌐</div>
        <b>数果网页版</b>
        <div class="muted" style="margin:6px 0;font-size:12.5px">电脑浏览器直接使用</div>
        <div class="sv-linkbox">${esc(SUGOO_WEB_LINK)}</div>
        <button class="btn btn-primary" style="margin-top:8px" onclick="window.open('${SUGOO_WEB_LINK}','_blank')">🚀 打开网页版</button>
        <div class="muted" style="margin-top:8px;font-size:12px">手机浏览器打开同样可用</div>
      </div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" onclick="closeModal()">关闭</button></div>`);
};

function renderAIDesk(main) {
  const list = state.db.aiTasks.filter(a => matches(a, state.query));
  const butlerArticles = state.db.media.filter(m => m.butler);
  const butlerToday = butlerArticles.filter(m => m.butlerDate === new Date().toISOString().slice(0, 10)).length;
  main.innerHTML = `<div class="page-head"><div><h2>AI 任务台</h2><div class="sub">发起任务 → 交给斜杠喵（WorkBuddy 内置能力）→ 结果归档，并生成方案/进度</div></div>
    <button class="btn btn-primary" onclick="openAITaskForm()">＋ 发起 AI 任务</button></div>
    <div class="sv-grid" style="margin-bottom:16px">
      <div class="card sv-card sv-hero" style="cursor:pointer" onclick="openSugooVideo()">
        <div class="sv-ic">🎬</div>
        <div style="flex:1"><b>AI 短视频生成</b><div class="muted" style="font-size:12.5px;margin-top:4px">文章素材一键转短视频口播脚本与成片</div></div>
        <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-sm" onclick="event.stopPropagation();copySugooLink()">📱 数果智能体小程序</button>
          <button class="btn btn-sm" onclick="event.stopPropagation();window.open('${SUGOO_WEB_LINK}','_blank')">🌐 数果网页版</button>
        </div>
      </div>
      <div class="card sv-card sv-hero">
        <div class="sv-ic">🦠</div>
        <div style="flex:1"><b>肠道管家 · 内容生产线</b><div class="muted" style="font-size:12.5px;margin-top:4px">全网检索 → AI 乔本风格改稿 → 自动配图 → 进文章库 · 今日 ${butlerToday} 篇 / 累计 ${butlerArticles.length} 篇</div></div>
        <button class="btn btn-sm btn-primary" style="flex:none" onclick="runGutButler()">▶ 立即产出素材</button>
      </div>
    </div>
    ${list.map(a => `
      <div class="ai-task"><div class="row" style="justify-content:space-between"><b>${esc(a.title)}</b><span class="chip ${statusChip(a.status)}">${a.status}</span></div>
      <div class="muted" style="margin:6px 0">发起人 ${mName(a.createdBy)} · ${timeAgo(a.createdAt || Date.now())} ${a.linkedType ? `· 关联 ${a.linkedType}` : ""}</div>
      <div class="doc-body" style="background:#fafbff;border:1px solid var(--line);border-radius:8px;padding:10px">${esc(a.prompt)}</div>
      <div class="res">${a.result ? esc(a.result) : "（结果待回填）"}</div>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-sm btn-primary" onclick="runAITask('${a.id}')">🤖 交给斜杠喵（自动执行）</button>
        <button class="btn btn-sm" onclick="editAIResult('${a.id}')">回填结果</button>
        <button class="btn btn-sm" onclick="aiResultToProposal('${a.id}')">转为方案</button>
        <button class="btn btn-sm btn-danger" onclick="del('aiTasks','${a.id}')">删除</button>
      </div></div>`).join("") || "<div class='empty'>暂无 AI 任务</div>"}`;
}
window.openAITaskForm = () => {
  openModal("发起 AI 任务", formHTML([
    { key: "title", label: "任务标题" },
    { key: "prompt", label: "任务指令", type: "textarea", placeholder: "把要 AI 做的事写清楚，会作为交给斜杠喵的 prompt" },
    { key: "linkedType", label: "关联类型(可选)", type: "select", options: [{ v: "", l: "无" }, { v: "proposal", l: "方案" }, { v: "task", l: "任务" }, { v: "customer", l: "客户" }] },
    { key: "linkedId", label: "关联ID(可选)", placeholder: "对应条目的 id" },
  ], {}) + attWidgetHTML("aitask", { hint: "上传参考资料（图片/文档），执行时自动解析给 AI" }));
  $("#formSubmit").onclick = async () => { const fd = readForm(); if (!fd.title || !fd.prompt) return toast("标题和指令必填"); const atts = attPayload("aitask"); if (atts.length) fd.attachmentIds = atts.map(a => a.id); await api("POST", "/aiTasks", { ...fd, status: "待处理" }); closeModal(); toast("已发起" + (atts.length ? `（含 ${atts.length} 个附件）` : "")); };
};
window.runAITask = async (id) => {
  toast("🤖 正在自动执行 AI 任务…");
  try {
    const r = await api("POST", `/aiTasks/${id}/autorun`);
    const fb = r.feedback || {};
    const map = { proposals: "方案", docs: "学习库课程", tasks: "任务说明", followups: "客户随访", media: "媒体库素材", aiTasks: "AI 任务结果" };
    const label = esc(fb.label || map[fb.collection] || "数据");
    const route = fb.collection === "proposals" ? "proposals" : fb.collection === "docs" ? "docs" : fb.collection === "followups" ? "customers" : fb.collection === "media" ? "media" : fb.collection === "tasks" ? "planexec" : "aidesk";
    toast("🤖 已自动执行，结果已写入【" + label + "】");
    openModal("🤖 自动执行完成 · " + esc(r.task.title || ""), `<p class="muted">已一键生成 AI 结果，并自动回写至「${label}」，与其他模块数据互通；可在对应模块查看。</p>
      <div class="doc-body" style="white-space:pre-wrap;max-height:52vh;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:12px;background:#fafbff">${esc(r.task.result || "")}</div>
      <div class="row" style="justify-content:flex-end;margin-top:12px">
        ${fb.collection && fb.collection !== "aiTasks" ? `<button class="btn btn-primary" onclick="goto('${route}')">查看写入结果 →</button>` : ""}
        <button class="btn" onclick="closeModal()">关闭</button></div>`);
  } catch (e) { toast("执行失败：" + (e.message || "")); }
};
window.editAIResult = (id) => {
  const a = state.db.aiTasks.find(x => x.id === id);
  openModal("回填 AI 结果", `<div class="field"><label>结果内容</label><textarea id="aiRes">${esc(a.result || "")}</textarea></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-primary" id="saveRes">保存</button></div>`);
  $("#saveRes").onclick = async () => { await api("PUT", `/aiTasks/${id}`, { result: $("#aiRes").value, status: "已完成" }); closeModal(); toast("已归档结果"); };
};
window.aiResultToProposal = async (id) => {
  const a = state.db.aiTasks.find(x => x.id === id);
  if (!a.result) return toast("请先回填结果");
  await api("POST", "/proposals", { title: a.title.replace(/^撰写方案：/, ""), content: a.result, status: "草稿", version: 1, createdBy: a.createdBy });
  toast("已生成方案，去「方案」查看");
};

const LEARN_CATS = ["乔本肠道管家", "门店SOP", "代理与合伙人", "短视频AI"];
let docCat = "全部";
// 勋章等级定义
const BADGE_TIERS = [
  { id: "bronze", name: "青铜", icon: "🥉", color: "#cd7f32", minScore: 1 },
  { id: "silver", name: "白银", icon: "🥈", color: "#c0c0c0", minScore: 30 },
  { id: "gold", name: "黄金", icon: "🥇", color: "#ffd700", minScore: 80 },
  { id: "diamond", name: "钻石", icon: "💎", color: "#b9f2ff", minScore: 150 },
  { id: "ur", name: "UR 稀有度", icon: "🌟", color: "#ff6b35", minScore: 300 },
];
function computeBadges(memberId) {
  const docs = state.db.docs;
  const myBadges = state.db.badges.filter(b => b.memberId === memberId);
  let totalMin = 0, totalScore = 0, passed = 0, courseCount = 0;
  docs.forEach(d => {
    const p = (d.progress || {})[memberId];
    if (p) {
      totalMin += p.minutes || 0;
      if (p.score != null) { totalScore += p.score; passed += p.passed ? 1 : 0; }
      if (p.minutes > 0) courseCount++;
    }
  });
  // 计算综合得分
  const composite = totalMin + totalScore * 2 + passed * 20 + courseCount * 10;
  // 确定等级
  let tier = BADGE_TIERS[0]; // bronze default
  for (const t of BADGE_TIERS) { if (composite >= t.minScore) tier = t; }
  // 动态勋章列表
  const earned = [...myBadges];
  // 自动勋章
  if (totalMin >= 30 && !earned.find(b => b.name === "学习先锋")) earned.push({ tier: "bronze", icon: "📚", name: "学习先锋", desc: `累计学习 ${totalMin} 分钟` });
  if (totalMin >= 120 && !earned.find(b => b.name === "知识达人")) earned.push({ tier: "silver", icon: "🧠", name: "知识达人", desc: `累计学习 ${totalMin} 分钟` });
  if (passed >= 3 && !earned.find(b => b.name === "考核之星")) earned.push({ tier: "gold", icon: "⭐", name: "考核之星", desc: `通过 ${passed} 门课程考核` });
  if (courseCount >= docs.length && docs.length >= 3 && !earned.find(b => b.name === "全科通关")) earned.push({ tier: "diamond", icon: "🏅", name: "全科通关", desc: `学完所有 ${docs.length} 门课程` });
  return { totalMin, totalScore, passed, courseCount, composite, tier, earned };
}
function renderBadgeWall(memberId) {
  const { totalMin, totalScore, passed, courseCount, composite, tier, earned } = computeBadges(memberId);
  const m = state.db.members.find(x => x.id === memberId);
  return `<div class="card" style="margin-bottom:16px;background:linear-gradient(135deg,#fafbff,#f5f0ff);border-color:${tier.color}40">
    <div class="row" style="align-items:center;gap:12px;margin-bottom:10px">
      <img src='mascot-head.png' class='mascot-img' style="width:48px;height:48px;border-width:3px;border-color:${tier.color}">
      <div><b style="font-size:16px">${esc(m?.name || "我")}</b>
        <div class="muted">${tier.icon} ${tier.name}级 · 综合分 ${composite}</div></div>
      <div style="margin-left:auto;display:flex;gap:14px">
        <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:var(--brand)">${totalMin}</div><div class="muted" style="font-size:11px">学习分钟</div></div>
        <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:var(--green)">${passed}</div><div class="muted" style="font-size:11px">通过考核</div></div>
        <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:var(--orange)">${courseCount}</div><div class="muted" style="font-size:11px">已学课程</div></div>
      </div>
    </div>
    <div class="badge-wall">
      ${earned.length ? earned.map(b => `<div class="badge tier-${b.tier || 'bronze'}">
        <span class="badge-icon">${b.icon}</span><span class="badge-name">${esc(b.name)}</span><span class="badge-tier">${BADGE_TIERS.find(t=>t.id===(b.tier||''))?.name || ""}</span>
      </div>`).join("") : '<div class="muted">开始学习即可获得勋章 🎖️</div>'}
    </div>
  </div>`;
}
function learnStats() {
  let totalMin = 0, taken = 0, scoreSum = 0, passed = 0;
  const perMember = {};
  state.db.docs.forEach(d => {
    const p = d.progress || {};
    Object.entries(p).forEach(([mid, v]) => {
      totalMin += v.minutes || 0;
      if (v.score != null) { taken++; scoreSum += v.score; if (v.passed) passed++; }
      perMember[mid] = perMember[mid] || { min: 0, scores: [] };
      perMember[mid].min += v.minutes || 0;
      if (v.score != null) perMember[mid].scores.push(v.score);
    });
  });
  return { totalMin, taken, avg: taken ? Math.round(scoreSum / taken) : 0, rate: taken ? Math.round(passed / taken * 100) : 0, perMember };
}
window.setDocCat = (c) => { docCat = c; render(); };
// ---------- 想法库：个人草稿与未完成计划（写完再发到平台） ----------
function renderIdeas(main) {
  const mine = state.db.drafts.filter(d => d.ownerId === state.user && matches(d, state.query));
  const published = mine.filter(d => d.status === "已发布");
  const drafting = mine.filter(d => d.status !== "已发布");
  const myPlans = state.db.plans.filter(p => p.ownerId === state.user && p.status !== "已完成" && matches(p, state.query));
  const stat = `<div class="grid cols-4" style="margin-bottom:14px">
    ${kpi("我的草稿", drafting.length, "📝")} ${kpi("已发布", published.length, "✅")} ${kpi("未完成计划", myPlans.length, "🛰️")} ${kpi("累计想法", mine.length, "💡")}
  </div>`;
  const draftCards = drafting.map(d => {
    const src = d.source === "buddy" ? "🤖 来自 Buddy" : d.source === "rewrite" ? "✨ 方案改写候选" : d.source === "proposal" ? "📄 来自方案版本" : "✍️ 手动创建";
    return `<div class="card"><div class="row" style="justify-content:space-between"><h3>${esc(d.title)}</h3><span class="chip">${src}</span></div>
      <div class="doc-body" style="max-height:130px;overflow:auto">${esc(d.content || "")}</div>
      <div class="meta">${timeAgo(d.updatedAt || d._created || Date.now())}${d.docId ? " · 已发学习库" : ""}${d.planId ? " · 已转计划" : ""}${d.proposalId ? " · 已转方案" : ""}</div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px">
        <button class="btn btn-sm" onclick="openIdeaForm('${d.id}')">✏️ 编辑</button>
        <button class="btn btn-sm" onclick="ideaPublishDoc('${d.id}')">📄 发到学习库</button>
        <button class="btn btn-sm" onclick="ideaToPlan('${d.id}')">🛰️ 转为计划</button>
        <button class="btn btn-sm" onclick="ideaToProposal('${d.id}')">📋 转为方案</button>
        <button class="btn btn-sm btn-danger" onclick="del('drafts','${d.id}')">删</button>
      </div></div>`;
  }).join("") || "<div class='empty'>还没有草稿——点右上角「＋ 记个想法」，或让 Buddy 生成后点「📝 存草稿」。</div>";
  const publishedCards = published.map(d => `<div class="card"><div class="row" style="justify-content:space-between"><h3>${esc(d.title)}</h3><span class="chip green">已发布</span></div>
      <div class="doc-body" style="max-height:90px;overflow:auto">${esc(d.content || "")}</div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px">
        ${d.docId ? `<button class="btn btn-sm" onclick="goto('docs')">📚 查看文档</button>` : ""}
        ${d.planId ? `<button class="btn btn-sm" onclick="goto('planexec')">🛰️ 查看计划</button>` : ""}
        ${d.proposalId ? `<button class="btn btn-sm" onclick="goto('proposals')">📋 查看方案</button>` : ""}
        <button class="btn btn-sm" onclick="openIdeaForm('${d.id}')">✏️ 编辑</button>
        <button class="btn btn-sm btn-danger" onclick="del('drafts','${d.id}')">删</button>
      </div></div>`).join("") || "<div class='muted'>暂无已发布内容</div>";
  const planList = myPlans.map(p => {
    const ts = state.db.tasks.filter(t => t.planId === p.id);
    const done = ts.filter(t => t.status === "done").length;
    return `<div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)">
      <span><b>${esc(p.title)}</b> <span class="chip">${p.status}</span></span>
      <span class="muted">${p.start || "—"} → ${p.end || "—"} · 任务 ${done}/${ts.length} · ${p.progress || 0}% <button class="btn btn-sm" style="margin-left:8px" onclick="goto('planexec')">去推进</button></span></div>`;
  }).join("") || "<div class='muted'>没有进行中的计划——可在计划库认领，或把草稿「转为计划」。</div>";
  main.innerHTML = `<div class="page-head"><div><h2>想法库</h2><div class="sub">你的私人草稿与灵感空间：先存想法、攒半成品（含方案改写候选），写完了再一键发到学习库、计划库或方案库（仅自己可见）</div></div>
    <button class="btn btn-primary" onclick="openIdeaForm()">＋ 记个想法</button></div>
    ${stat}
    <div class="card" style="margin-bottom:16px"><h3>📝 我的草稿（${drafting.length}）</h3><div class="grid cols-2">${draftCards}</div></div>
    <div class="card" style="margin-bottom:16px"><h3>✅ 已发布（${published.length}）</h3><div class="grid cols-2">${publishedCards}</div></div>
    <div class="card"><h3>🛰️ 我的未完成计划（${myPlans.length}）</h3>${planList}</div>`;
}
window.openIdeaForm = (id) => {
  const d = id ? state.db.drafts.find(x => x.id === id) : {};
  openModal(id ? "编辑想法/草稿" : "记个想法", formHTML([
    { key: "title", label: "标题", placeholder: "一句话概括这个想法" },
    { key: "content", label: "内容", type: "textarea", placeholder: "想法、草稿、半成品方案……随时存，写完再发到平台" },
  ], d));
  $("#formSubmit").onclick = async () => {
    const fd = readForm(); if (!fd.title) return toast("请填标题");
    if (id) await api("PUT", `/drafts/${id}`, { ...fd, updatedAt: Date.now() });
    else await api("POST", "/drafts", { ...fd, ownerId: state.user, status: "草稿", source: "manual", createdAt: Date.now(), updatedAt: Date.now() });
    closeModal(); toast("已存入想法库");
  };
};
window.ideaPublishDoc = async (id) => {
  const d = state.db.drafts.find(x => x.id === id); if (!d) return;
  if (!state.canEdit) return toast("发布需要协作者/管理员权限，可先把草稿转给负责人");
  try {
    const doc = await api("POST", "/docs", {
      title: d.title, category: "AI生成", type: "doc", duration: 0,
      body: d.content || "", author: state.user, updatedAt: Date.now(), progress: {},
    });
    await api("PUT", `/drafts/${id}`, { status: "已发布", docId: doc.id, updatedAt: Date.now() });
    toast("已发布到学习库");
  } catch (e) { toast("发布失败：" + (e.message || "")); }
};
window.ideaToPlan = async (id) => {
  const d = state.db.drafts.find(x => x.id === id); if (!d) return;
  if (!state.canEdit) return toast("转计划需要协作者/管理员权限，可先把草稿转给负责人");
  try {
    const p = await api("POST", "/plans", {
      title: d.title, desc: d.content || "", status: "进行中",
      ownerId: state.user, start: new Date().toISOString().slice(0, 10), end: "",
      progress: 0, collaborators: [],
    });
    await api("PUT", `/drafts/${id}`, { status: "已发布", planId: p.id, updatedAt: Date.now() });
    toast("已转为计划，可在计划与执行进度里推进");
  } catch (e) { toast("转计划失败：" + (e.message || "")); }
};
// 草稿 → 方案库（想法库 ↔ 方案库 打通：AI 改写候选/方案版本暂存打磨后回写）
window.ideaToProposal = async (id) => {
  const d = state.db.drafts.find(x => x.id === id); if (!d) return;
  if (!state.canEdit) return toast("转方案需要协作者/管理员权限，可先把草稿转给负责人");
  try {
    const pr = await api("POST", "/proposals", {
      title: d.title.replace(/\s*[··]\s*(改写候选|v\d+)$/, ""), content: d.content || "",
      status: "草稿", version: 1, createdBy: state.user,
      source: "draft", draftId: d.id,
    });
    await api("PUT", `/drafts/${id}`, { status: "已发布", proposalId: pr.id, updatedAt: Date.now() });
    toast("已转为方案（v1 草稿），可到「方案」继续改写升版");
    render();
  } catch (e) { toast("转方案失败：" + (e.message || "")); }
};
function renderDocs(main) {
  const all = state.db.docs.filter(d => matches(d, state.query));
  const list = docCat === "全部" ? all : all.filter(d => d.category === docCat);
  const st = learnStats();
  const tabs = ["全部", ...LEARN_CATS].map(c => `<button class="btn btn-sm ${docCat === c ? "btn-primary" : ""}" onclick="setDocCat('${c}')">${c}</button>`).join("");
  const stat = `<div class="grid cols-4" style="margin-bottom:14px">
    ${kpi("课程数", all.length, "📚")} ${kpi("总学习时长", st.totalMin + " 分", "⏱️")} ${kpi("考核平均分", st.avg, "🎯")} ${kpi("通过率", st.rate + "%", "✅")}
  </div>`;
  const leaderboard = Object.entries(st.perMember).sort((a, b) => b[1].min - a[1].min).map(([mid, v]) => {
    const m = state.db.members.find(x => x.id === mid); if (!m) return "";
    const avg = v.scores.length ? Math.round(v.scores.reduce((a, b) => a + b, 0) / v.scores.length) : "—";
    return `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)"><span><b>${esc(m.name)}</b> <span class="muted">${esc(m.role || "")}</span></span><span><span class="chip">⏱ ${v.min}分</span> <span class="chip green">🎯 ${avg}</span></span></div>`;
  }).join("") || "<div class='muted'>暂无学习记录</div>";
  const cards = list.map(d => {
    const p = (d.progress && d.progress[state.user]) || {};
    const hasQuiz = (d.quiz && d.quiz.length);
    return `<div class="card"><div class="row" style="justify-content:space-between"><h3>${esc(d.title)}</h3><span class="chip brand">${esc(d.category)}</span></div>
      <div class="muted" style="margin:4px 0">⏱ ${d.duration || 0} 分钟${hasQuiz ? ` · 📝 考核(${d.quiz.length}题)` : ""}</div>
      <div class="doc-body" style="max-height:110px;overflow:auto">${esc(d.body)}</div>
      <div class="meta">${mName(d.author)} · ${timeAgo(d.updatedAt || Date.now())}${p.minutes ? ` · 我的时长 ${p.minutes}分` : ""}${p.score != null ? ` · 我的分数 ${p.score}${p.passed ? " ✅" : ""}` : ""}</div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px">
        <button class="btn btn-sm btn-primary" onclick="openStudy('${d.id}')">学习</button>
        ${hasQuiz ? `<button class="btn btn-sm" onclick="openQuiz('${d.id}')">考核</button>` : ""}
        <button class="btn btn-sm" onclick="openDocForm('${d.id}')">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="del('docs','${d.id}')">删</button>
      </div></div>`;
  }).join("") || "<div class='empty'>暂无内容</div>";
  main.innerHTML = `<div class="page-head"><div><h2>学习库</h2><div class="sub">乔本肠道管家 / 门店SOP / 代理与合伙人 / 短视频AI —— 学时与考核统一追踪 + 勋章系统</div></div>
    <button class="btn btn-primary" onclick="openDocForm()">＋ 新建课程</button></div>

    <!-- 勋章墙（最前端） -->
    ${renderBadgeWall(state.user)}

    ${stat}
    <div class="row" style="gap:8px;margin-bottom:12px">${tabs}</div>
    <div class="grid cols-2" style="margin-bottom:16px">${cards}</div>
    <div class="card"><h3>🏆 学习排行榜（按累计时长）</h3>${leaderboard}</div>`;
}
window.openDocForm = (id) => {
  const d = id ? state.db.docs.find(x => x.id === id) : {};
  openModal(id ? "编辑课程" : "新建课程", formHTML([
    { key: "title", label: "标题" },
    { key: "category", label: "分类", type: "select", options: ["总纲", ...LEARN_CATS].map(c => ({ v: c, l: c })) },
    { key: "type", label: "类型", type: "select", options: [{ v: "lesson", l: "课程" }, { v: "doc", l: "文档" }] },
    { key: "duration", label: "时长(分钟)", type: "number" },
    { key: "body", label: "正文", type: "textarea", placeholder: "课程内容正文（支持多段）" },
  ], d));
  $("#modalBody").insertAdjacentHTML("afterbegin", aiBtn("doc", "body", { titleField: "title", hint: "让 AI 帮你生成课程/知识库内容。" }));
  $("#formSubmit").onclick = async () => {
    const fd = readForm(); if (!fd.title) return toast("请填标题");
    if (fd.duration) fd.duration = Number(fd.duration) || 0;
    id ? await api("PUT", `/docs/${id}`, fd) : await api("POST", "/docs", fd);
    closeModal(); toast("已保存");
  };
};
window.openStudy = async (id) => {
  const d = state.db.docs.find(x => x.id === id);
  openModal("学习：" + d.title, `<p class="muted">课程时长 ${d.duration || 0} 分钟。记录你本次学习用时（可累加）。</p>
    <div class="field"><label>本次学习时长(分钟)</label><input id="studyMin" type="number" value="${d.duration || 0}" /></div>
    <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" id="saveStudy">记录</button></div>`);
  $("#saveStudy").onclick = async () => {
    const mins = Number($("#studyMin").value) || 0;
    const prog = { ...(d.progress || {}) };
    const me = prog[state.user] || { minutes: 0, score: null, passed: false };
    me.minutes = (me.minutes || 0) + mins; prog[state.user] = me;
    await api("PUT", `/docs/${id}`, { progress: prog }); closeModal(); toast("已记录 " + mins + " 分钟");
  };
};
window.openQuiz = (id) => {
  const d = state.db.docs.find(x => x.id === id);
  const qs = d.quiz || [];
  const body = qs.map((q, i) => `<div style="margin:12px 0"><b>${i + 1}. ${esc(q.q)}</b>${q.options.map((o, j) => `<div style="margin:4px 0"><label><input type="radio" name="q${i}" value="${j}"> ${esc(o)}</label></div>`).join("")}</div>`).join("");
  openModal("考核：" + d.title, `<div id="quizBox">${body}</div>
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn btn-primary" id="submitQuiz">提交</button></div>`);
  $("#submitQuiz").onclick = async () => {
    let correct = 0; const total = qs.length;
    qs.forEach((q, i) => { const sel = document.querySelector(`input[name='q${i}']:checked`); if (sel && Number(sel.value) === q.answer) correct++; });
    const score = Math.round(correct / total * 100); const passed = score >= 60;
    const prog = { ...(d.progress || {}) };
    const me = prog[state.user] || { minutes: 0, score: null, passed: false };
    me.score = score; me.passed = passed; me.at = Date.now(); prog[state.user] = me;
    await api("PUT", `/docs/${id}`, { progress: prog });
    openModal("考核结果", `<div style="text-align:center;padding:10px"><div style="font-size:40px">${score} 分</div>
      <div class="chip ${passed ? 'green' : 'red'}">${passed ? '✅ 通过' : '❌ 未通过(需≥60)'}</div>
      <div class="muted" style="margin-top:8px">答对 ${correct}/${total}</div></div>
      `);
  };
};
window.sendChat = async () => {
  const el = $("#chatInput"); if (!el) return;
  const text = (el.value || "").trim(); if (!text) return;
  const msg = { id: "msg_" + Date.now(), roomId: chatRoom, from: state.user, text, ts: Date.now() };
  try {
    await api("POST", "/messages", msg);
    state.db.messages.push(msg);
    el.value = "";
    renderChatMessages();
    broadcast({ type: "mutation", col: "messages", action: "create", data: msg });
  } catch(e) { toast("发送失败：" + e.message); }
};
window.renderChatMessages = () => {
  const box = $("#chatMsgBox"); if (!box) return;
  const msgs = getChatMessages();
  if (!msgs.length) { box.innerHTML = '<div class="muted" style="text-align:center;padding:30px">暂无消息，开始对话吧 🎉</div>'; return; }
  box.innerHTML = msgs.map(m => {
    const isSelf = m.from === state.user;
    return `<div class="chat-bubble ${isSelf ? 'self' : 'other'}">
      <div>${esc(m.text)}</div>
      <div class="meta">${mName(m.from)} · ${timeAgo(m.ts)}</div>
    </div>`;
  }).join("");
  box.scrollTop = 999999;
};
window.switchChatRoom = (id) => { chatRoom = id; render(); };
window.chatInsertTask = () => {
  const el = $("#chatInput"); if (!el) return;
  const tasks = state.db.tasks.filter(t => t.status !== "done").slice(0, 8);
  openModal("引用任务到聊天", `<div class="muted" style="margin-bottom:8px">选择一个任务插入到消息中（@任务）</div>
    <div id="chatTaskList">${tasks.map(t => `<div class="chat-task-item" data-tid="${t.id}" style='padding:8px;border:1px solid var(--line);border-radius:8px;margin:6px 0;cursor:pointer'><b>${esc(t.title)}</b><div class='muted'>${esc(t.category)} · ${ownerBadge(t.ownerId)}</div></div>`).join("") || "<div class='muted'>暂无进行中的任务</div>"}</div>`);
  setTimeout(() => {
    $$("#chatTaskList .chat-task-item").forEach(div => {
      div.onclick = () => { chatDoInsertTask(div.dataset.tid); };
    });
  }, 50);
};
window.chatDoInsertTask = (tid) => {
  const t = state.db.tasks.find(x => x.id === tid); if (!t) return;
  const el = $("#chatInput");
  if (el) el.value += ` @任务【${t.title}】(${tid}) `;
  closeModal();
};
window.chatAIAssist = () => {
  const el = $("#chatInput"); if (!el) return;
  const id = "_chat_" + Date.now();
  const ctxId = "chatAI_" + id;
  _aiCfgs[id] = { kind: "generic", targetField: "_chatDummy", hint: "让 AI 帮你生成一条专业消息内容。" };
  $("#aiModalTitle").textContent = "🤖 AI 协助写消息";
  $("#aiModalBody").innerHTML = `
    <div class="muted" style="margin-bottom:8px">描述你想发的消息内容，AI 将基于乔本·数果业务知识生成草稿。</div>
    <div class="field"><label>给 AI 的指令</label><textarea id="aiPrompt" placeholder="例如：写一条提醒团队本周重点的消息…" style="min-height:100px"></textarea></div>
    ${attWidgetHTML(ctxId, { hint: "可上传参考截图/文档" })}
    <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn" type="button" onclick="document.getElementById('aiModal').classList.add('hidden')">取消</button><button class="btn btn-primary" id="aiGo">🤖 生成并填入</button></div>`;
  $("#aiModal").classList.remove("hidden");
  const go = $("#aiGo");
  go.onclick = async () => {
    const prompt = $("#aiPrompt").value.trim(); if (!prompt) return toast("请填写指令");
    go.disabled = true; go.textContent = "生成中…";
    try {
      const atts = attPayload(ctxId);
      const r = await api("POST", "/ai/generate", { kind: "generic", prompt, attachments: atts.map(a => a.id) });
      el.value = r.result || "";
      $("#aiModal").classList.add("hidden");
      toast("AI 已生成消息草稿，可编辑后发送");
    } catch(e) { toast("失败：" + e.message); }
    finally { go.disabled = false; go.textContent = "🤖 生成并填入"; }
  };
};

$("#globalSearch").oninput = (e) => { state.query = e.target.value; render(); };

// ---------- 实时同步 ----------
let ws;
function broadcast(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function sendPresence() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "presence", memberId: state.user, name: mName(state.user) })); }
function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => { $("#connState").textContent = "● 已连接（实时）"; $("#connState").style.color = "var(--green)"; sendPresence(); };
  ws.onclose = () => { $("#connState").textContent = "● 断开，重连中…"; $("#connState").style.color = "var(--red)"; setTimeout(connectWS, 2000); };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "mutation") {
      if (msg.col === "shares") { refreshInbox(); }
      else if (msg.col && COLS.includes(msg.col)) {
        if (msg.action === "delete") state.db[msg.col] = state.db[msg.col].filter(x => x.id !== msg.data.id);
        else { const i = state.db[msg.col].findIndex(x => x.id === msg.data.id); if (i >= 0) state.db[msg.col][i] = msg.data; else state.db[msg.col].push(msg.data); }
        if (msg.event) state.db.events = [msg.event, ...state.db.events].slice(0, 200);
        render();
      }
    } else if (msg.type === "full-reload") { state.db = msg.db; renderNav(); renderUserSwitch(); render(); }
    else if (msg.type === "presence") { renderPresence(msg.members); }
  };
}
function renderPresence(members) {
  const uniq = []; const seen = new Set();
  members.forEach(m => { if (!seen.has(m.id)) { seen.add(m.id); uniq.push(m); } });
  $("#presence").innerHTML = uniq.map(m => `<div class="av" title="${esc(m.name)} 在线" style="background:${mColor(m.id)}">${esc(m.name[0])}</div>`).join("") + `<span class="muted" style="font-size:12px;margin-left:6px">${uniq.length} 在线</span>`;
}

// ---------- 登录与权限（注册 + 申请 → 审批） ----------
let authMode = "login"; // "login" | "register"

function showLogin(msg) {
  const box = $("#loginBox");
  if (!box) return;
  box.classList.remove("hidden");
  const tip = $("#loginTip");
  if (tip) tip.textContent = msg || "输入你的 WorkBuddy 名字即可申请加入";
  setTimeout(() => { const el = $("#joinName"); if (el) el.focus(); }, 50);
}

// 登录错误内联显示（避免被登录遮罩盖住看不到提示）
function setLoginErr(msg) {
  const el = $("#loginErr");
  if (!el) return;
  if (msg) { el.textContent = msg; el.classList.remove("hidden"); }
  else { el.textContent = ""; el.classList.add("hidden"); }
}

// 名字即身份：输入 WorkBuddy 名字 → 自动建号/登录 + 申请访问
async function doJoin() {
  const u = ($("#joinName").value || "").trim();
  const dn = ($("#joinDisplay").value || "").trim();
  const pw = ($("#joinPw").value || "").trim();
  setLoginErr("");
  if (!u || u.length < 2) return setLoginErr("名字至少 2 个字符");
  if (!pw) return setLoginErr("请输入密码");
  try {
    const res = await fetch("/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, displayName: dn || u, password: pw }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setLoginErr(d.error || "登录失败，请检查名字与密码");
    setLoginErr("");
    applyAuth(d);
  } catch (e) { setLoginErr("请求失败：" + e.message); }
}

function applyAuth(d) {
  localStorage.setItem("qb_token", d.token);
  localStorage.setItem("qb_user", d.user);
  localStorage.setItem("qb_role", d.role);
  state.token = d.token; state.authUser = d.user; state.role = d.role;
  state.user = "m_" + d.user;
  state.canEdit = d.role === "editor" || d.role === "admin";
  $("#loginBox").classList.add("hidden");
  let hint = "";
  if (d.requestStatus === "pending") hint = "已提交访问申请，等待管理员审批（当前只读）";
  else if (state.role === "user") hint = "当前只读，可在右上角申请编辑权限";
  renderAuthBadge();
  loadAll().then(() => {
    connectWS();
    toast("欢迎，" + (d.displayName || d.user) + getRoleLabel(d.role) + (hint ? "：" + hint : ""));
    const open = new URLSearchParams(location.search).get("open");
    if (open) { const [c, id] = open.split("/"); openLinkedItem(c, id); }
  }).catch(onLoadFail);
}

function getRoleLabel(role) {
  if (role === "admin") return "（管理员）";
  if (role === "editor") return "（协作者）";
  return "（只读）";
}

function doLogout() {
  localStorage.removeItem("qb_token"); localStorage.removeItem("qb_user"); localStorage.removeItem("qb_role");
  location.reload();
}

// 申请编辑权限
async function applyForAccess() {
  try {
    const res = await api("POST", "/apply-access", { reason: "" });
    const d = await res.json();
    toast(d.message || "申请已提交");
    renderAuthBadge(); // 刷新按钮状态
  } catch (e) { /* api handles 401/403 */ }
}

// 管理员审批面板
async function showApprovalPanel() {
  try {
    const res = await fetch("/api/access-requests", { headers: { "Authorization": "Bearer " + state.token } });
    const d = await res.json().catch(() => ({ pending: [] }));
    const list = d.pending || [];
    if (!list.length) return toast("暂无待审批的申请 ✅");
    let html = `<div class="approval-panel"><h4>📋 待审批申请 (${list.length})</h4>`;
    for (const ar of list) {
      html += `<div class="approval-item">
        <div><b>${esc(ar.displayName || ar.username)}</b> <span class="muted">@${esc(ar.username)}</span></div>
        <div class="muted" style="font-size:12px">${new Date(ar.requestedAt).toLocaleString()}</div>
        <div class="row" style="gap:6px;margin-top:6px">
          <button class="btn btn-sm btn-primary" onclick="approveRequest('${ar.id}')">✅ 通过</button>
          <button class="btn btn-sm" onclick="rejectRequest('${ar.id}')">❌ 拒绝</button>
        </div>
      </div>`;
    }
    html += `</div>`;
    // 用 modal 显示
    openModal("访问审批", html, () => {});
  } catch (e) { toast("获取审批列表失败"); }
}

async function approveRequest(id) {
  try {
    const res = await fetch(`/api/access-requests/${id}/approve`, { method: "POST", headers: { "Authorization": "Bearer " + state.token, "Content-Type": "application/json" } });
    const d = await res.json();
    toast(d.message || "已通过");
    showApprovalPanel(); // 刷新
  } catch (e) { toast("操作失败"); }
}

async function rejectRequest(id) {
  try {
    const res = await fetch(`/api/access-requests/${id}/reject`, { method: "POST", headers: { "Authorization": "Bearer " + state.token, "Content-Type": "application/json" } });
    const d = await res.json();
    toast(d.message || "已拒绝");
    showApprovalPanel();
  } catch (e) { toast("操作失败"); }
}

function renderAuthBadge() {
  const el = $("#authBadge");
  if (!el) return;
  if (!state.authUser) { el.innerHTML = ""; return; }
  const roleTxt = state.role === "admin" ? "管理员" : state.canEdit ? "协作者" : "只读";
  let btns = "";
  btns += `<button class="auth-btn" onclick="openInbox()">📥 收件箱${state.inboxUnread ? `<span class="badge-dot">${state.inboxUnread}</span>` : ""}</button>`;
  if (state.role === "admin") btns += `<button class="auth-btn" onclick="showApprovalPanel()">📋 审批</button>`;
  if (state.canEdit) btns += `<button class="auth-btn" onclick="openPushCenter()">📤 推送</button>`;
  if (!state.canEdit && state.authUser) btns += `<button class="auth-btn auth-warn" onclick="openRename()">📝 提交申请</button>`;
  btns += `<button class="auth-btn" onclick="openRename()">✏️ 改名</button>`;
  btns += `<button class="auth-logout" onclick="doLogout()">退出</button>`;
  el.innerHTML = `<span class="auth-user">${esc(state.authUser)}</span><span class="auth-role ${state.canEdit ? 'ed' : 'ro'}">${roleTxt}</span>${btns}`;
  document.body.classList.toggle("readonly", !state.canEdit);
  applyReadonly();
}

// 只读（未审批）模式：隐藏所有操作类按钮（删除 / 编辑 / 下载 / 转发 / 推送 / 领取 / 转让等），仅保留查看
function applyReadonly() {
  const banner = document.getElementById("roBanner");
  const dismissed = localStorage.getItem("qb_ro_dismissed") === "1";
  if (banner) {
    if (state.canEdit) localStorage.removeItem("qb_ro_dismissed"); // 审批通过后清掉记忆
    banner.classList.toggle("hidden", state.canEdit || dismissed);
  }
  if (state.canEdit) return;
  const RE = /(openPropForm|openMediaForm|openFeedbackForm|openCustomerForm|openFollowForm|openReportForm|openMemberForm|openExpertForm|openToolForm|openAITaskForm|openDocForm|openTransferModal|claimTask|del\(|openForwardModal|openPushModal|saveAsTask|openPushCenter|openInvite|openRewriteModal|propRestoreVer|ideaToProposal)/;
  // 注意：聊天(sendChat/switchChatRoom/openGroupForm/chatInsertTask/chatAIAssist)与 openWechatPush 对所有成员开放，不隐藏
  document.querySelectorAll("button[onclick],a[onclick]").forEach(el => {
    if (RE.test(el.getAttribute("onclick") || "")) el.style.display = "none";
  });
  document.querySelectorAll("a[download]").forEach(el => { el.style.display = "none"; });
}

// 收起只读提示横幅（本次记住，审批通过前不再自动弹出）
window.dismissRoBanner = () => {
  const b = document.getElementById("roBanner");
  if (b) b.classList.add("hidden");
  localStorage.setItem("qb_ro_dismissed", "1");
};

// ---------- 启动 ----------
if (!state.token) {
  if (new URLSearchParams(location.search).get("join")) showLogin("通过邀请链接加入：输入你的 WorkBuddy 名字即可申请访问");
  else showLogin("输入你的 WorkBuddy 名字即可申请加入");
} else {
  loadAll().then(() => {
    renderAuthBadge();
    connectWS();
    const open = new URLSearchParams(location.search).get("open");
    if (open) { const [c, id] = open.split("/"); openLinkedItem(c, id); }
  }).catch(onLoadFail);
}

// ---------- 移动端侧边栏抽屉 ----------
window.toggleSidebar = (force) => {
  const open = typeof force === "boolean" ? force : !document.body.classList.contains("nav-open");
  document.body.classList.toggle("nav-open", open);
};
const _navEl = document.getElementById("nav");
if (_navEl) _navEl.addEventListener("click", (e) => { if (e.target.closest(".nav-item")) document.body.classList.remove("nav-open"); });

// ---------- 助理Buddy：全能 AI 对话入口（真实大模型，流式回复） ----------
let buddyHistory = []; // [{role:'user'|'assistant', content, seed?, docId?, planId?}]
let buddyAbort = null; // 生成中的 AbortController；非空 = 生成中（发送键变停止键）
let buddyLoaded = false; // 是否已从服务端加载持久记忆
async function buddySync() {
  try { await api("PUT", "/buddy/history", { messages: buddyHistory.filter(m => !m.seed) }); } catch { /* 静默失败，不打断对话 */ }
}
async function buddyLoad() {
  if (buddyLoaded) return;
  buddyLoaded = true;
  try {
    const h = await api("GET", "/buddy/history");
    if (Array.isArray(h) && h.length) buddyHistory = h;
  } catch { /* 未登录等情况忽略 */ }
}
window.buddyClear = async () => {
  if (!confirm("确定清空 Buddy 的对话记忆吗？此操作不可恢复。")) return;
  try { await api("DELETE", "/buddy/history"); } catch { /* 尽力清空 */ }
  buddyHistory = [];
  buddyRender();
  toast("记忆已清空");
};
function buddyTitle(text) {
  const line = String(text || "").split("\n").map(s => s.trim()).find(s => s && !/^#{1,6}$/.test(s)) || "Buddy 回复";
  return line.replace(/^[#>*\-\s]+/, "").replace(/^#+\s*/, "").slice(0, 40) || "Buddy 回复";
}
function buddyActions(m) {
  const i = buddyHistory.indexOf(m);
  let html = '<div class="bmsg-actions">';
  html += m.draftId
    ? '<button class="btn btn-sm" onclick="buddyGoto(\'ideas\')">📝 查看草稿</button>'
    : '<button class="btn btn-sm" onclick="buddySaveDraft(' + i + ')">📝 存草稿</button>';
  html += m.docId
    ? '<button class="btn btn-sm" onclick="buddyGoto(\'docs\')">📁 查看文档</button>'
    : '<button class="btn btn-sm" onclick="buddySaveDoc(' + i + ')">📄 存为文档</button>';
  html += m.planId
    ? '<button class="btn btn-sm" onclick="buddyGoto(\'planexec\')">🛰️ 查看计划</button>'
    : '<button class="btn btn-sm" onclick="buddyToPlan(' + i + ')">🛰️ 发到计划库</button>';
  html += m.proposalId
    ? '<button class="btn btn-sm" onclick="buddyGoto(\'proposals\')">📋 查看方案</button>'
    : '<button class="btn btn-sm" onclick="buddyToProposal(' + i + ')">📋 转为方案</button>';
  html += "</div>";
  return html;
}
function buddyRender(streaming) {
  const box = $("#buddyMsgs");
  if (!box) return;
  if (!buddyHistory.length) {
    buddyHistory = [{ role: "assistant", content: "你好，我是助理 Buddy 🤖 全能 AI——写方案、做分析、出脚本、答疑解惑都行，直接说需求就好。\n回复下方可存草稿、存文档、发到计划库或转为方案。", seed: true }];
  }
  box.innerHTML = buddyHistory.map((m, i) => {
    const thinking = streaming && i === buddyHistory.length - 1;
    const acts = (m.role === "assistant" && !m.seed && !thinking && (m.content || "").trim()) ? buddyActions(m) : "";
    const attChips = (m.role === "user" && m.attIds && m.attIds.length)
      ? `<div class="bmsg-atts">${m.attIds.map(a => `<span class="att-chip-mini">📎 ${esc(a.name)}</span>`).join("")}</div>` : "";
    return `<div class="bmsg ${m.role}${thinking ? " think" : ""}">${attChips}${esc(m.content || "…")}${acts}</div>`;
  }).join("");
  box.scrollTop = box.scrollHeight;
}
window.buddyQuick = (text) => { const el = $("#buddyInput"); if (el) el.value = text; window.buddySend(); };
window.buddySend = async () => {
  if (buddyAbort) { buddyAbort.abort(); return; }
  const el = $("#buddyInput");
  const text = (el && el.value || "").trim();
  const atts = attPayload("buddy");
  if (!text && !atts.length) return toast("请输入内容，或上传附件让 AI 分析");
  if (el) el.value = "";
  const attMeta = atts.length ? { attIds: atts } : undefined;
  buddyHistory.push({ role: "user", content: text, ...(attMeta || {}) });
  _att["buddy"] = []; attRender("buddy");
  buddyHistory.push({ role: "assistant", content: "" });
  buddyRender(true);
  const btn = $("#buddySend");
  const cur = buddyHistory.length - 1;
  const ctrl = new AbortController(); buddyAbort = ctrl;
  const setBusy = (b) => { if (!btn) return; btn.innerHTML = b ? "⏹ 停止生成" : "🚀 发送（Enter）"; btn.classList.toggle("btn-danger", b); };
  setBusy(true);
  let acc = "";
  try {
    const r = await fetch("/api/buddy/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (state.token || "") },
      body: JSON.stringify({ messages: buddyHistory.slice(0, -1).filter(m => !m.seed), attachments: atts.map(a => a.id) }),
      signal: ctrl.signal,
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "HTTP " + r.status); }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const p = s.slice(5).trim();
        if (!p || p === "[DONE]") continue;
        let j; try { j = JSON.parse(p); } catch { continue; }
        if (j.error) throw new Error(j.error);
        if (j.delta) { acc += j.delta; buddyHistory[cur].content = acc; buddyRender(true); }
      }
    }
    if (!acc) { buddyHistory[cur].content = "（模型没有返回内容，请重试或稍后再试）"; buddyRender(); }
    else buddyRender();
  } catch (e) {
    if (e && (e.name === "AbortError" || String(e.message || "").includes("abort"))) {
      buddyHistory[cur].content = (acc ? acc + "\n\n" : "") + "（已停止生成）";
    } else {
      buddyHistory[cur].content = "⚠️ " + (e.message || "调用失败");
    }
    buddyRender();
  } finally {
    buddyAbort = null;
    setBusy(false);
    buddySync();
    if (el) el.focus();
  }
};
window.buddySaveDraft = async (i) => {
  const m = buddyHistory[i]; if (!m || !m.content) return;
  try {
    const d = await api("POST", "/drafts", {
      title: buddyTitle(m.content), content: m.content, ownerId: state.user,
      status: "草稿", source: "buddy", createdAt: Date.now(), updatedAt: Date.now(),
    });
    m.draftId = d.id; buddyRender(); buddySync();
    toast("已存入想法库草稿，可到「智能 → 想法库」继续完善");
  } catch (e) { toast("存草稿失败：" + (e.message || "")); }
};
window.buddySaveDoc = async (i) => {
  const m = buddyHistory[i]; if (!m || !m.content) return;
  try {
    const d = await api("POST", "/docs", {
      title: buddyTitle(m.content), category: "AI生成", type: "doc", duration: 0,
      body: m.content, author: state.user, updatedAt: Date.now(), progress: {},
    });
    m.docId = d.id; buddyRender(); buddySync();
    toast("已存入学习库，可点「查看文档」打开");
  } catch (e) { toast("存文档失败：" + (e.message || "")); }
};
window.buddyToPlan = async (i) => {
  const m = buddyHistory[i]; if (!m || !m.content) return;
  try {
    const p = await api("POST", "/plans", {
      title: buddyTitle(m.content), desc: m.content, status: "进行中",
      ownerId: state.user, start: new Date().toISOString().slice(0, 10), end: "",
      progress: 0, collaborators: [],
    });
    m.planId = p.id; buddyRender(); buddySync();
    toast("已发到计划库，可点「查看计划」打开");
  } catch (e) { toast("发送失败：" + (e.message || "")); }
};
// Buddy 对话产出 → 方案库（打通：对话成果可直接成为方案 v1 草稿）
window.buddyToProposal = async (i) => {
  const m = buddyHistory[i]; if (!m || !m.content) return;
  if (!state.canEdit) return toast("转方案需要协作者/管理员权限，可先「存草稿」到想法库再转给负责人");
  try {
    const pr = await api("POST", "/proposals", {
      title: buddyTitle(m.content), content: m.content,
      status: "草稿", version: 1, createdBy: state.user, source: "buddy",
    });
    m.proposalId = pr.id; buddyRender(); buddySync();
    toast("已转为方案（v1 草稿），可点「查看方案」继续 AI 改写升版");
  } catch (e) { toast("转方案失败：" + (e.message || "")); }
};
window.buddyGoto = (route) => {
  const panel = $("#buddyPanel"); if (panel) panel.classList.add("hidden");
  state.route = route; location.hash = route; renderNav(); render();
};
(function initBuddy() {
  const fab = $("#buddyFab"), panel = $("#buddyPanel"), close = $("#buddyClose"), send = $("#buddySend"), input = $("#buddyInput");
  // 附件区初始化（Buddy 对话支持拖拽/粘贴/点选上传）
  const attZone = $("#buddyAttZone");
  if (attZone) attZone.innerHTML = attWidgetHTML("buddy", { hint: "支持图片 / PDF / Word / Excel 等，可拖拽或粘贴" });
  attEnableDrop("buddy", "#buddyPanel");
  attEnablePaste("buddy", "#buddyInput");
  if (fab) fab.onclick = async () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      await buddyLoad(); // 首次打开时拉取持久记忆
      buddyRender();
      if (input) setTimeout(() => input.focus(), 50);
    }
  };
  if (close) close.onclick = () => panel.classList.add("hidden");
  if (send) send.onclick = () => window.buddySend();
  if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); window.buddySend(); } });
  document.addEventListener("click", (e) => {
    if (panel && !panel.classList.contains("hidden") && !panel.contains(e.target) && e.target !== fab && !fab.contains(e.target)) panel.classList.add("hidden");
  });
})();

// ---------- Cmd+K 快捷搜索 ----------
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    const s = document.getElementById("globalSearch");
    if (s) { s.focus(); s.select(); }
  }
});
