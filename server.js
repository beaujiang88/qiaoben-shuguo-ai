// 乔本·数果 AI 肠道健康管理项目 — 后端服务
// Node + Express + ws；JSON 文件做共享数据库；WebSocket 做实时多人同步
import "dotenv/config"; // 从 .env 加载环境变量（已被 .gitignore 忽略，不入库）
import express from "express";
import crypto from "crypto";
import { WebSocketServer } from "ws";
import { nanoid } from "nanoid";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { execFile } from "child_process";
import { promisify } from "util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3088;
// 云端部署：绑定全部网卡（0.0.0.0），由 PaaS/容器映射外部端口
const HOST = process.env.HOST || "0.0.0.0";

// ---------- AI 多模态输入：本地文件上传与文本提取 ----------
const AI_FILES_DIR = path.join(__dirname, "data", "ai-files");
fs.mkdirSync(AI_FILES_DIR, { recursive: true });
const AI_EXTRACT_CACHE = path.join(AI_FILES_DIR, "extracted.json");
function extractCacheAll() { try { return JSON.parse(fs.readFileSync(AI_EXTRACT_CACHE, "utf8")); } catch { return {}; } }
function extractCachePut(id, rec) { const all = extractCacheAll(); all[id] = rec; fs.writeFileSync(AI_EXTRACT_CACHE, JSON.stringify(all)); }
function extractCacheGet(id) { return extractCacheAll()[id] || null; }
const _execFile = promisify(execFile);
const _jxaTimeout = 60000;
function _safe(pathStr) { return pathStr.replace(/'/g, "\\'"); }
function _ext(name) { return (path.extname(name || "").toLowerCase() || ""); }
function fileKindByExt(ext) {
  if ([".txt",".md",".csv",".json",".log",".xml",".htm",".html"].includes(ext)) return "text";
  if ([".doc",".docx",".rtf",".webarchive",".odt"].includes(ext)) return "doc";
  if ([".pdf"].includes(ext)) return "pdf";
  if ([".xlsx",".xls"].includes(ext)) return "sheet";
  if ([".pptx",".ppt"].includes(ext)) return "slides";
  if ([".png",".jpg",".jpeg",".gif",".bmp",".tiff",".tif",".webp",".heic",".heif"].includes(ext)) return "image";
  return "other";
}
async function extractDocxText(filePath) {
  try {
    const { stdout } = await _execFile("textutil", ["-convert", "txt", "-stdout", filePath], { timeout: 20000, encoding: "utf8" });
    return { text: stdout || "", engine: "textutil" };
  } catch (e) { return { text: "", engine: "textutil", error: e.message }; }
}
async function extractSheetText(filePath) {
  try {
    // 优先 sharedStrings，fallback 第一个 worksheet
    let out = "";
    try { const { stdout } = await _execFile("unzip", ["-p", filePath, "xl/sharedStrings.xml"], { timeout: 15000, encoding: "utf8" }); out = stdout; } catch {}
    if (!out) {
      try { const { stdout } = await _execFile("unzip", ["-p", filePath, "xl/worksheets/sheet1.xml"], { timeout: 15000, encoding: "utf8" }); out = stdout; } catch {}
    }
    const text = out.replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
    return { text, engine: "unzip-xlsx" };
  } catch (e) { return { text: "", engine: "unzip-xlsx", error: e.message }; }
}
async function extractSlidesText(filePath) {
  try {
    const { stdout } = await _execFile("sh", ["-c", `unzip -p '${_safe(filePath)}' "ppt/slides/slide*.xml" | sed 's/<[^>]*>//g'`], { timeout: 20000, encoding: "utf8" });
    const text = (stdout || "").replace(/\n{3,}/g, "\n\n").trim();
    return { text, engine: "unzip-pptx" };
  } catch (e) { return { text: "", engine: "unzip-pptx", error: e.message }; }
}
async function extractPdfText(filePath, outPath) {
  const jxa = `ObjC.import('Quartz');ObjC.import('Foundation');
const url = $.NSURL.fileURLWithPath('${_safe(filePath)}');
const doc = $.PDFDocument.alloc.initWithURL(url);
if (!doc) { console.log('__ERR__:cannot open'); } else {
  let out = '';
  for (let i = 0; i < doc.pageCount; i++) { out += (doc.pageAtIndex(i).string ? doc.pageAtIndex(i).string.js : '') + '\\n'; }
  $.NSString.alloc.initWithUTF8String(out).writeToFileAtomicallyEncodingError('${_safe(outPath)}', true, $.NSUTF8StringEncoding, null);
  console.log('__OK__');
}`;
  const tmp = path.join(AI_FILES_DIR, "tmp_" + nanoid(8) + ".jxa");
  fs.writeFileSync(tmp, jxa, "utf8");
  try {
    await _execFile("osascript", ["-l", "JavaScript", tmp], { timeout: _jxaTimeout, encoding: "utf8" });
    if (fs.existsSync(outPath)) { const t = fs.readFileSync(outPath, "utf8"); return { text: t, engine: "pdfkit" }; }
    return { text: "", engine: "pdfkit", error: "no output" };
  } catch (e) { return { text: "", engine: "pdfkit", error: e.message }; } finally { try { fs.unlinkSync(tmp); } catch {} }
}
async function extractImageOcr(filePath, outPath) {
  // 若格式非 PNG/JPG，先 sips 转成 PNG（OCR 兼容性更好）
  let src = filePath;
  const ext = _ext(filePath);
  if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") {
    const tmpPng = path.join(AI_FILES_DIR, "tmp_" + nanoid(8) + ".png");
    try {
      await _execFile("sips", ["-s", "format", "png", filePath, "--out", tmpPng], { timeout: 15000 });
      src = tmpPng;
    } catch {}
  }
  const jxa = `ObjC.import('Vision');ObjC.import('Foundation');
const imgURL = $.NSURL.fileURLWithPath('${_safe(src)}');
const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(imgURL, ObjC.wrap({}));
const req = $.VNRecognizeTextRequest.alloc.initWithCompletionHandler(function(){});
req.recognitionLevel = 'VNRequestTextRecognitionLevelAccurate';
req.usesLanguageCorrection = true;
req.recognitionLanguages = ['zh-Hans','en-US'];
const ok = handler.performRequestsError(ObjC.wrap([req]), null);
let lines = [];
if (ok) {
  const obs = req.results;
  for (let i = 0; i < obs.count; i++) {
    const o = obs.objectAtIndex(i);
    const cands = o.topCandidates(1);
    if (cands && cands.count > 0) lines.push(cands.objectAtIndex(0).string.js);
  }
}
const text = lines.join('\\n');
$.NSString.alloc.initWithUTF8String(text).writeToFileAtomicallyEncodingError('${_safe(outPath)}', true, $.NSUTF8StringEncoding, null);
console.log('__OK__ lines=' + lines.length);`;
  const tmp = path.join(AI_FILES_DIR, "tmp_" + nanoid(8) + ".jxa");
  fs.writeFileSync(tmp, jxa, "utf8");
  try {
    await _execFile("osascript", ["-l", "JavaScript", tmp], { timeout: _jxaTimeout, encoding: "utf8" });
    if (fs.existsSync(outPath)) { const t = fs.readFileSync(outPath, "utf8"); return { text: t, engine: "vision-ocr" }; }
    return { text: "", engine: "vision-ocr", error: "no output" };
  } catch (e) { return { text: "", engine: "vision-ocr", error: e.message }; } finally {
    try { fs.unlinkSync(tmp); } catch {}
    if (src !== filePath) { try { fs.unlinkSync(src); } catch {} }
  }
}
async function extractFileText(filePath) {
  const ext = _ext(filePath);
  const kind = fileKindByExt(ext);
  const outPath = path.join(AI_FILES_DIR, "tmp_extract_" + nanoid(8) + ".txt");
  if (kind === "text") {
    try { const t = fs.readFileSync(filePath, "utf8"); return { text: t, engine: "read" }; } catch (e) { return { text: "", engine: "read", error: e.message }; }
  }
  if (kind === "doc") return extractDocxText(filePath);
  if (kind === "sheet") return extractSheetText(filePath);
  if (kind === "slides") return extractSlidesText(filePath);
  if (kind === "pdf") { const r = await extractPdfText(filePath, outPath); try { fs.unlinkSync(outPath); } catch {} return r; }
  if (kind === "image") { const r = await extractImageOcr(filePath, outPath); try { fs.unlinkSync(outPath); } catch {} return r; }
  return { text: "", engine: "none", error: "不支持的文件类型：" + ext };
}
function fmtAttachments(atts) {
  if (!Array.isArray(atts) || !atts.length) return "";
  return "\n\n【参考资料（用户提供）】\n" + atts.map((a, i) =>
    `—— 附件${i + 1}：${a.name || "未命名"} ——\n${String(a.text || "").slice(0, 12000) || "（该附件未能提取到文字内容）"}`
  ).join("\n\n");
}

// 头像配色（新成员自动分配）
const MEMBER_COLORS = ["#7c5cff", "#1e9e6a", "#e8833a", "#2f80ed", "#e0533d", "#16a085", "#8e44ad", "#d35400"];
function pickColor() { return MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)]; }

// ---------- 共享数据库（JSON 文件） ----------
const COLLECTIONS = [
  "members", "plans", "tasks", "proposals", "feedback",
  "customers", "experts", "tools", "aiTasks", "docs", "kbDocs", "events",
  "followups", "reports", "media", "messages", "badges",
  "users", "accessRequests", "shares", "chatRooms", "drafts"
];

function seed() {
  const now = Date.now();
  const members = [
    { id: "m_beau", name: "beau（乔本）", role: "项目负责人", color: "#7c5cff", online: false },
    { id: "m_lin", name: "林博士", role: "肠道微生态专家", color: "#1e9e6a", online: false },
    { id: "m_zhao", name: "赵运营", role: "客户运营", color: "#e8833a", online: false },
    { id: "m_qian", name: "钱产品", role: "产品经理", color: "#2f80ed", online: false },
  ];
  const plans = [
    { id: "p_1", title: "产品与商业模式定义", desc: "明确服务包、定价与会员模型，完成商业计划书", status: "进行中", ownerId: "m_beau", start: "2026-08-01", end: "2026-09-30", progress: 55 },
    { id: "p_2", title: "渠道招商体系搭建", desc: "省代/市代/区代/门店/合伙人分级政策与首批招募", status: "进行中", ownerId: "m_beau", start: "2026-08-10", end: "2026-10-31", progress: 35 },
    { id: "p_3", title: "试点客户运营与随访闭环", desc: "招募试点 C 端、建立随访时间线与复测机制", status: "进行中", ownerId: "m_zhao", start: "2026-08-15", end: "2026-11-15", progress: 25 },
    { id: "p_4", title: "AI 能力与知识库建设", desc: "干预 SOP、培训体系、AI 方案/话术生成", status: "进行中", ownerId: "m_lin", start: "2026-08-20", end: "2026-10-15", progress: 40 },
    { id: "p_5", title: "合规与数据安全", desc: "数据隐私合规、检测合作机构资质审核", status: "待启动", ownerId: "m_beau", start: "2026-09-01", end: "2026-11-30", progress: 0 },
  ];
  const tasks = [
    { id: "t_1", planId: "p_1", category: "产品规划", title: "完成肠道健康管理产品定义与服务包设计", status: "doing", ownerId: "m_beau", due: "2026-09-05", progress: 70, priority: "高", desc: "定义核心服务包：菌群检测 + AI 解读 + 个性化干预 + 随访闭环；明确单客 LTV 与交付标准。" },
    { id: "t_2", planId: "p_1", category: "产品规划", title: "确定定价与会员订阅模型", status: "todo", ownerId: "m_qian", due: "2026-09-20", progress: 20, priority: "高", desc: "设计三档会员（体验/标准/尊享）+ 复购权益，测算毛利率与回本周期。" },
    { id: "t_3", planId: "p_1", category: "产品规划", title: "撰写商业计划书（BP）", status: "todo", ownerId: "m_beau", due: "2026-09-25", progress: 0, priority: "中", desc: "面向投资人与内部对齐的商业计划书，含市场/产品/模式/财务。" },
    { id: "t_4", planId: "p_2", category: "市场招商", title: "制定省代/市代/区代/门店/合伙人分级政策与分润", status: "doing", ownerId: "m_beau", due: "2026-09-10", progress: 60, priority: "高", desc: "明确各级拿货门槛、分润比例、区域保护与合规红线（不涉多级返利）。" },
    { id: "t_5", planId: "p_2", category: "市场招商", title: "招募首批省代 2 家", status: "todo", ownerId: "", due: "2026-10-10", progress: 0, priority: "高", desc: "目标：华南、华东各 1 家省代；筛选标准：渠道资源 + 资金 + 团队。可领取。" },
    { id: "t_6", planId: "p_2", category: "门店运营", title: "门店 SOP 与陈列物料", status: "todo", ownerId: "", due: "2026-10-20", progress: 0, priority: "中", desc: "产出门店肠道测评 SOP、转化话术、陈列与海报物料包。可领取。" },
    { id: "t_7", planId: "p_3", category: "门店运营", title: "招募 20 名试点 C 端客户", status: "doing", ownerId: "m_zhao", due: "2026-09-30", progress: 30, priority: "高", desc: "通过门店 + 私域社群招募，标准：便秘/IBS 自评阳性、付费意愿强。" },
    { id: "t_8", planId: "p_3", category: "客户服务", title: "建立随访时间线与复测机制", status: "doing", ownerId: "m_zhao", due: "2026-09-15", progress: 45, priority: "高", desc: "第 0/2/4/8 周随访节点 + 复测对比，沉淀到客户详情时间线。" },
    { id: "t_9", planId: "p_3", category: "客户服务", title: "菌群检测报告解读流程", status: "doing", ownerId: "m_lin", due: "2026-09-12", progress: 50, priority: "中", desc: "统一解读模板：维度评分 + 风险 + 干预建议，AI + 专家双审。" },
    { id: "t_10", planId: "p_4", category: "培训考核", title: "编写肠道菌群干预 SOP", status: "doing", ownerId: "m_lin", due: "2026-09-10", progress: 55, priority: "高", desc: "益生菌 + 膳食纤维 + 饮食三维干预方案，含禁忌与不良反应处理。" },
    { id: "t_11", planId: "p_4", category: "培训考核", title: "搭建知识库与代理商培训体系", status: "todo", ownerId: "m_lin", due: "2026-10-01", progress: 10, priority: "中", desc: "4 大类课程 + 考核，支撑各级代理与门店培训。" },
    { id: "t_12", planId: "p_4", category: "技术开发", title: "接入 AI 方案/话术生成能力", status: "todo", ownerId: "m_beau", due: "2026-10-10", progress: 0, priority: "中", desc: "对接大模型端口，支持方案撰写、随访话术、短视频脚本生成。" },
    { id: "t_13", planId: "p_5", category: "合规风控", title: "数据隐私与合规方案", status: "todo", ownerId: "m_beau", due: "2026-10-15", progress: 0, priority: "中", desc: "客户健康数据加密存储、授权同意、最小可用原则。" },
    { id: "t_14", planId: "p_5", category: "合规风控", title: "检测合作机构资质审核", status: "todo", ownerId: "m_beau", due: "2026-11-10", progress: 0, priority: "低", desc: "核验第三方检测机构资质、报告合规性与数据接口安全。" },
  ];
  const proposals = [
    { id: "pr_1", title: "肠道健康管理商业计划书（摘要）", customerId: null, relatedTaskId: "t_3", content: "一、市场：中国肠道菌群检测与干预市场年增速 >30%，便秘/IBS/代谢综合征人群基数庞大。\n二、产品：以「菌群检测 + AI 解读 + 个性化干预（益生菌/膳食纤维/饮食）+ 随访闭环」为核心服务包。\n三、模式：B 端（省代/市代/区代/门店/合伙人）渠道分销 + C 端会员订阅；按检测、方案、复购分润。\n四、节奏：Q3 完成产品与招商体系，Q4 跑通试点 20 人闭环，次年规模化。\n五、壁垒：专家 SOP + 知识库 + AI 能力沉淀。", version: 1, status: "草稿", createdBy: "m_beau", updatedAt: now - 86400000 },
    { id: "pr_2", title: "渠道分级招商政策 V1", customerId: null, relatedTaskId: "t_4", content: "分级：省代 / 市代 / 区代 / 门店 / 合伙人。\n门槛与分润（示例）：\n- 省代：首批进货 ¥20万，渠道分润 35%，管辖市代。\n- 市代：首批 ¥5万，分润 30%。\n- 区代：首批 ¥1万，分润 25%。\n- 门店：零门槛联营，分润 20% + 引流补贴。\n- 合伙人：招商裂变，推荐下级返点 5%。\n权益：统一培训、知识库、AI 话术、检测解读支持。", version: 1, status: "评审中", createdBy: "m_beau", updatedAt: now - 3600000 },
    { id: "pr_3", title: "试点客户随访 SOP", customerId: null, relatedTaskId: "t_8", content: "随访节点：第 0 周（基线检测+解读）、第 2 周（依从回访）、第 4 周（症状复盘）、第 8 周（复测对比）。\n内容：症状评分、依从性、饮食执行、不良反应。\n工具：随访时间线 + 菌群检测指标维度对比图。\n目标：干预有效率达 70%+，复购率 40%+。", version: 1, status: "草稿", createdBy: "m_zhao", updatedAt: now - 1800000 },
  ];
  const followups = [
    { id: "fu_1", customerId: "c_1", date: "2026-08-18", type: "首访解读", byMember: "m_lin", content: "完成基线菌群检测解读，Shannon 偏低、F/B 比偏高，双歧杆菌不足；给出益生菌+膳食纤维方案。" },
    { id: "fu_2", customerId: "c_1", date: "2026-08-25", type: "第2周回访", byMember: "m_zhao", content: "依从性良好，排便频率由 2→4 次/周，腹胀评分 7→4；继续方案。" },
    { id: "fu_3", customerId: "c_2", date: "2026-08-20", type: "测评", byMember: "m_zhao", content: "完成问卷测评，便秘自评阳性，已预约菌群检测。" },
  ];
  const reports = [
    { id: "rp_1", customerId: "c_1", date: "2026-08-18", title: "基线菌群检测报告", dimensions: [
      { name: "菌群多样性(Shannon)", value: "3.1", unit: "", ref: "≥3.8", status: "偏低" },
      { name: "厚壁菌/拟杆菌比(F/B)", value: "1.6", unit: "", ref: "0.8-1.2", status: "偏高" },
      { name: "双歧杆菌 相对丰度", value: "1.2", unit: "%", ref: "≥3%", status: "偏低" },
      { name: "乳酸杆菌 相对丰度", value: "0.8", unit: "%", ref: "≥2%", status: "偏低" },
      { name: "阿克曼菌 Akkermansia", value: "0.3", unit: "%", ref: "≥0.5%", status: "偏低" },
      { name: "短链脂肪酸(SCFA)", value: "低", unit: "", ref: "正常", status: "偏低" },
      { name: "粪便钙卫蛋白(炎症)", value: "正常", unit: "", ref: "正常", status: "正常" },
    ] },
  ];
  // 数据反馈：分「代理 / 门店 / 客户」三类来源，统一管理、数据互通
  const feedback = [
    // —— 代理反馈（B 端渠道：省代/市代/区代/合伙人）——
    { id: "f_1", source: "代理", targetId: "c_b1", metric: "本月出货(盒)", value: "1200", note: "华南省代月度动销，环比 +18%", date: "2026-08-20", linkedTaskId: "t_1" },
    { id: "f_2", source: "代理", targetId: "c_b2", metric: "本月新增门店(家)", value: "8", note: "深圳市代本月新拓 8 家门店", date: "2026-08-18", linkedTaskId: "" },
    { id: "f_3", source: "代理", targetId: "c_b5", metric: "本月招商人数", value: "15", note: "合伙人本月新增招商 15 人", date: "2026-08-15", linkedTaskId: "" },
    // —— 门店反馈（B 端门店）——
    { id: "f_4", source: "门店", targetId: "c_b4", metric: "到店体验人数", value: "186", note: "海岸城门店本月到店肠道测评人数", date: "2026-08-19", linkedTaskId: "" },
    { id: "f_5", source: "门店", targetId: "c_b4", metric: "C端转化率(%)", value: "32", note: "到店转方案购买率", date: "2026-08-19", linkedTaskId: "" },
    // —— 客户反馈（C 端终端用户）——
    { id: "f_6", source: "客户", targetId: "c_1", metric: "排便频率(次/周)", value: "5", note: "干预 2 周后由 2 次提升至 5 次", date: "2026-08-20", linkedTaskId: "t_1" },
    { id: "f_7", source: "客户", targetId: "c_1", metric: "腹胀评分(0-10)", value: "3", note: "由 7 分降至 3 分", date: "2026-08-20", linkedTaskId: "t_1" },
  ];
  // 客户系统：B 端（渠道/代理） + C 端（终端用户），统一路径管理
  const customers = [
    // —— B 端：省代 → 市代 → 区代 → 门店 → 合伙人 ——
    { id: "c_b1", type: "B", name: "华南省代·康健生物", tier: "省代", region: "广东", parentId: "", contact: "020-88****01", level: "A", stage: "合作中", tags: ["省代", "强渠道"], notes: "覆盖华南三省，下辖市代若干", sourceBId: "", createdAt: now - 2000000000 },
    { id: "c_b2", type: "B", name: "深圳市代·益生堂", tier: "市代", region: "深圳", parentId: "c_b1", contact: "0755-66****02", level: "A", stage: "合作中", tags: ["市代"], notes: "深圳地区门店网络", sourceBId: "c_b1", createdAt: now - 1500000000 },
    { id: "c_b3", type: "B", name: "福田区代·微生态馆", tier: "区代", region: "深圳福田", parentId: "c_b2", contact: "138****1103", level: "B", stage: "合作中", tags: ["区代"], notes: "福田片区门店管理", sourceBId: "c_b2", createdAt: now - 1000000000 },
    { id: "c_b4", type: "B", name: "海岸城门店", tier: "门店", region: "深圳福田", parentId: "c_b3", contact: "139****3304", level: "B", stage: "运营中", tags: ["门店"], notes: "日均到店 30+，C 端转化主阵地", sourceBId: "c_b3", createdAt: now - 800000000 },
    { id: "c_b5", type: "B", name: "合伙人·王总", tier: "合伙人", region: "全国", parentId: "", contact: "137****5506", level: "A", stage: "招募中", tags: ["合伙人", "招商"], notes: "负责招商与裂变，直属于总部", sourceBId: "", createdAt: now - 500000000 },
    // —— C 端：终端消费者（由 B 端带来） ——
    { id: "c_1", type: "C", name: "王女士", contact: "138****0021", level: "A", stage: "干预中", tags: ["IBS", "高管", "高依从"], notes: "35 岁，长期腹胀，付费意愿强", sourceBId: "c_b4", createdAt: now - 1209600000 },
    { id: "c_2", type: "C", name: "陈先生", contact: "139****8832", level: "B", stage: "测评", tags: ["便秘"], notes: "45 岁，体检肠菌紊乱", sourceBId: "c_b4", createdAt: now - 604800000 },
    { id: "c_3", type: "C", name: "刘阿姨", contact: "136****7755", level: "C", stage: "复购", tags: ["糖尿病前期", "高净值"], notes: "经市代推荐入群", sourceBId: "c_b2", createdAt: now - 300000000 },
  ];
  const experts = [
    { id: "ex_butler", name: "肠道管家", domain: "肠道健康内容官", desc: "每日全网检索肠道菌群与肠道保养知识与文章，AI 改稿成乔本风格，源源不断产出文章素材进文章库；配图由 AI 自动生成，规避版权风险。", color: "#1e9e6a", pipeline: "gut-butler" },
    { id: "ex_micro", name: "菌群解读顾问", domain: "肠道微生态 / 检测解读", desc: "专注菌群检测报告解读：维度评分、风险分层与干预建议，AI + 专家双审。", color: "#2f80ed" },
    { id: "ex_comply", name: "内容合规审核", domain: "健康科普合规", desc: "审核健康科普表述边界，避免夸大疗效与违规承诺，把关肠道管家产出的对外内容。", color: "#e0533d" },
  ];
  const tools = [
    { id: "tl_1", name: "菌群检测报告解读", category: "AI 分析", desc: "上传检测报告，AI 输出菌群失衡解读与干预建议", link: "", skill: "菌群报告解读", connectorId: "报告解读连接器", connected: true, expertId: "ex_micro" },
    { id: "tl_2", name: "饮食推荐引擎", category: "AI 干预", desc: "根据菌群与目标生成个性化食谱", link: "", skill: "个性化食谱", connectorId: "食谱生成连接器", connected: false, expertId: "" },
    { id: "tl_3", name: "随访自动提醒", category: "运营", desc: "按计划推送随访与复测提醒", link: "", skill: "随访提醒", connectorId: "随访提醒连接器", connected: true, expertId: "ex_micro" },
    { id: "tl_butler", name: "肠道内容自动生产线", category: "内容生产", desc: "肠道管家每日全网检索肠道健康知识 → AI 改稿乔本风格 → 自动配图 → 进文章库，每天自动产出 1 篇", link: "", skill: "全网检索 + AI 改稿 + 配图生成", connectorId: "内容管线连接器", connected: true, expertId: "ex_butler", pipeline: "gut-butler" },
    { id: "tl_sv", name: "AI 短视频生成", category: "内容生产", desc: "跳转数果智能体小程序 / 数果网页版，用文章库素材生成短视频", link: "https://sugoo.asia/zh", skill: "文生视频", connectorId: "数果智能体", connected: true, expertId: "", pipeline: "sugoo-video" },
  ];
  const aiTasks = [
    { id: "a_1", title: "撰写肠道健康管理商业计划书", prompt: "请基于乔本·数果 AI 的定位，撰写一份肠道健康管理商业计划书，包含市场、产品、商业模式、运营节奏。", status: "待处理", result: "", createdBy: "m_beau", createdAt: now - 7200000, linkedType: "proposal", linkedId: "" },
    { id: "a_2", title: "生成试点客户随访话术", prompt: "针对 IBS 试点客户，生成首周、第 2 周、第 4 周的随访话术模板。", status: "待处理", result: "", createdBy: "m_zhao", createdAt: now - 1800000, linkedType: "task", linkedId: "t_2" },
  ];
  // 知识库 → 学习库：4 大类 + 总纲，含时长(duration)与考核(quiz)，进度按成员存 progress
  const docs = [
    { id: "d_1", title: "项目愿景与定位", category: "总纲", type: "doc", duration: 0,
      body: "乔本·数果 AI 旨在通过 AI + 菌群检测，提供个性化、可追踪的肠道健康管理服务。核心闭环：测评 → 解读 → 干预 → 随访 → 反馈。", author: "m_beau", updatedAt: now - 86400000, progress: {} },
    // 乔本肠道管家
    { id: "d_2", title: "肠道菌群基础知识", category: "乔本肠道管家", type: "lesson", duration: 15,
      body: "人体肠道菌群由上千种微生物组成，厚壁菌门与拟杆菌门占主导。菌群失衡（dysbiosis）与便秘、腹胀、肠易激(IBS)、肥胖、代谢综合征密切相关。\n关键指标：菌群多样性、有益菌(双歧杆菌/乳酸杆菌)占比、条件致病菌(如产气荚膜梭菌)水平。",
      quiz: [
        { q: "人体肠道菌群中占比最高的两大门类通常是？", options: ["厚壁菌门、拟杆菌门", "放线菌门、变形菌门", "蓝藻门、螺旋体门"], answer: 0 },
        { q: "菌群失衡的英文术语是？", options: ["Symbiosis", "Dysbiosis", "Microbiota"], answer: 1 },
        { q: "以下哪项与肠道菌群失衡关联性较弱？", options: ["肠易激(IBS)", "肥胖/代谢综合征", "头发颜色"], answer: 2 },
      ], author: "m_lin", updatedAt: now - 80000000, progress: {} },
    { id: "d_3", title: "乔本肠道管家服务流程", category: "乔本肠道管家", type: "lesson", duration: 20,
      body: "乔本肠道管家的标准服务五步：\n1. 测评：健康问卷 + 肠道菌群检测\n2. 解读：AI 输出菌群失衡维度评分与风险\n3. 干预：个性化益生菌 + 膳食纤维 + 饮食方案\n4. 随访：第 2/4/8 周复测与调整\n5. 复盘：指标变化归档，形成健康档案。",
      quiz: [
        { q: "乔本肠道管家的第一步是？", options: ["直接卖益生菌", "测评(问卷+检测)", "邀请进群"], answer: 1 },
        { q: "随访建议在干预后的哪些周次复测？", options: ["第1/2/3周", "第2/4/8周", "仅第8周"], answer: 1 },
      ], author: "m_beau", updatedAt: now - 70000000, progress: {} },
    // 门店SOP
    { id: "d_4", title: "门店肠道健康测评 SOP", category: "门店SOP", type: "lesson", duration: 18,
      body: "门店测评标准动作：\n1. 破冰：以「肠道年龄自测」小工具吸引到店客户\n2. 问卷：采集排便、饮食、睡眠、情绪等基线\n3. 引导检测：介绍菌群检测盒，扫码下单\n4. 预约解读：3 个工作日内 AI + 专家解读回访\n5. 建档：客户进入门店 C 端库，绑定来源渠道。",
      quiz: [
        { q: "门店测评的第一步应当是？", options: ["直接推销检测盒", "破冰+肠道年龄自测", "拉黑不感兴趣客户"], answer: 1 },
        { q: "客户做完问卷后下一步是？", options: ["结束服务", "引导检测并预约解读", "要求立即付款"], answer: 1 },
        { q: "客户建档时应绑定？", options: ["上级代理", "来源渠道(B端)", "无需绑定"], answer: 1 },
      ], author: "m_zhao", updatedAt: now - 60000000, progress: {} },
    { id: "d_5", title: "门店客户转化与跟进 SOP", category: "门店SOP", type: "lesson", duration: 16,
      body: "转化路径：测评 → 1v1 解读 → 方案购买 → 复购/转介绍。\n关键话术：用「你的菌群多样性偏低、产气荚膜梭菌偏高」等报告结论建立专业信任；用 21 天干预周期降低决策门槛。\n跟进节奏：解读后第 3/7/14/30 天四次触达。",
      quiz: [
        { q: "降低客户决策门槛的有效周期是？", options: ["1 天", "21 天干预周期", "1 年"], answer: 1 },
        { q: "解读后建议的跟进触达次数是？", options: ["1 次", "4 次(3/7/14/30天)", "永不跟进"], answer: 1 },
      ], author: "m_zhao", updatedAt: now - 50000000, progress: {} },
    // 代理与合伙人
    { id: "d_6", title: "代理分级与招商政策", category: "代理与合伙人", type: "lesson", duration: 22,
      body: "渠道层级：省代 → 市代 → 区代 → 门店 → 合伙人。\n招商政策要点：各级首批拿货门槛、季度动销指标、价格体系(全国统一零售价+分级折扣)、区域保护。\n省代负责下辖市代招商与培训；市代负责区代与门店拓展；区代管理门店运营。",
      quiz: [
        { q: "渠道层级的正确顺序是？", options: ["门店→省代→市代", "省代→市代→区代→门店→合伙人", "合伙人→省代"], answer: 1 },
        { q: "区域保护属于哪类政策？", options: ["招商政策", "薪酬政策", "物流政策"], answer: 0 },
        { q: "市代的主要职责是？", options: ["只做零售", "负责区代与门店拓展", "只招商省代"], answer: 1 },
      ], author: "m_beau", updatedAt: now - 40000000, progress: {} },
    { id: "d_7", title: "合伙人裂变与分润机制", category: "代理与合伙人", type: "lesson", duration: 14,
      body: "合伙人定位：招商与裂变，直属于总部或省代。\n分润机制：推荐新代理/门店的招募奖励 + 其下游动销的流水分润(多级受限，合规为一至两级)。\n合规红线：不得涉及多级返利、不得夸大收益宣传。",
      quiz: [
        { q: "合伙人分润合规的级数通常为？", options: ["无限制多级", "一至两级", "五级"], answer: 1 },
        { q: "以下哪项是合规红线？", options: ["提供培训", "多级返利/夸大收益", "区域保护"], answer: 1 },
      ], author: "m_beau", updatedAt: now - 30000000, progress: {} },
    // 短视频AI
    { id: "d_8", title: "短视频脚本与 AI 生成实战", category: "短视频AI", type: "lesson", duration: 25,
      body: "三步产出爆款短视频：\n1. 选题：围绕「肠道健康误区/一日菌群调理/客户真实案例」等高互动话题\n2. 脚本：用 AI 生成 3 版 30s 口播脚本(钩子+痛点+方案+引导)\n3. 生成：AI 配音 + 数字人/实拍混剪 + 字幕包装。\n发布节奏：每周 3-5 条，统一话题标签 #乔本肠道管家。",
      quiz: [
        { q: "30s 口播脚本的黄金结构是？", options: ["钩子+痛点+方案+引导", "只放产品图", "纯音乐"], answer: 0 },
        { q: "建议的发布节奏是？", options: ["每月 1 条", "每周 3-5 条", "从不发布"], answer: 1 },
      ], author: "m_qian", updatedAt: now - 20000000, progress: {} },
    { id: "d_9", title: "AI 数字人 / 口播视频制作", category: "短视频AI", type: "lesson", duration: 20,
      body: "数字人口播工作流：\n1. 选形象/音色(品牌统一形象库)\n2. 输入脚本，AI 生成口型同步视频\n3. 背景替换(门店/实验室场景)\n4. 加字幕、品牌角标、CTA 组件\n5. 多平台一键分发。\n注意：数字人需标注「AI 生成」，合规不误导。",
      quiz: [
        { q: "数字人视频必须注意的合规点是？", options: ["无需标注", "标注「AI 生成」不误导", "伪装真人"], answer: 1 },
        { q: "AI 口播视频生成的第一步是？", options: ["直接发布", "选形象/音色+输入脚本", "购买流量"], answer: 1 },
      ], author: "m_qian", updatedAt: now - 10000000, progress: {} },
  ];
  const events = [
    { id: "ev_1", ts: now - 7200000, actor: "m_beau", text: "创建了 AI 任务：商业计划书" },
    { id: "ev_2", ts: now - 3600000, actor: "m_lin", text: "更新了知识库：肠道菌群干预 SOP" },
    { id: "ev_3", ts: now - 1800000, actor: "m_zhao", text: "提交了方案：试点客户招募话术" },
  ];
  // 媒体库：功能文章 / 健康知识 / 图片 / 视频，可推送给客户（pushedTo 记录已推送的客户）；region 区域分类
  const media = [
    { id: "m_1", kind: "图文文章", category: "功能文章", title: "肠道菌群与情绪：脑肠轴揭秘", url: "https://mp.weixin.qq.com/s/example-brain-gut", desc: "科普脑肠轴如何双向影响情绪与消化，适合推给压力型便秘客户。", tags: ["脑肠轴", "情绪", "便秘"], pushedTo: [], createdAt: now - 90000000, region: "通用" },
    { id: "m_2", kind: "图文文章", category: "功能文章", title: "21 天肠道调理食谱大全", url: "https://mp.weixin.qq.com/s/example-diet", desc: "高纤维食谱 + 发酵食物清单，干预期客户每日可参考。", tags: ["食谱", "膳食纤维"], pushedTo: [], createdAt: now - 80000000, region: "通用" },
    { id: "m_3", kind: "知识", category: "健康知识", title: "益生菌正确服用指南", url: "https://mp.weixin.qq.com/s/example-probiotic", desc: "服用时间、水温、与抗生素间隔等注意事项，降低客户误操作。", tags: ["益生菌", "依从性"], pushedTo: ["c_1"], createdAt: now - 70000000, region: "通用" },
    { id: "m_4", kind: "图片海报", category: "图片素材", title: "门店陈列海报·肠道年龄自测", url: "https://example.com/poster-gut-age.png", desc: "到店引流主视觉，扫码自测肠道年龄。", tags: ["门店", "海报", "引流"], pushedTo: [], createdAt: now - 60000000, region: "华南" },
    { id: "m_5", kind: "图片海报", category: "图片素材", title: "菌群检测报告样例(脱敏)", url: "https://example.com/report-sample.png", desc: "给潜在客户看的脱敏样本，建立专业信任。", tags: ["检测", "样本"], pushedTo: [], createdAt: now - 55000000, region: "通用" },
    { id: "m_6", kind: "视频", category: "视频素材", title: "乔本肠道管家·品牌介绍短片", url: "https://example.com/brand-intro.mp4", desc: "60s 品牌故事，适合朋友圈/社群首触。", tags: ["品牌", "介绍"], pushedTo: [], createdAt: now - 50000000, region: "全国" },
    { id: "m_7", kind: "视频", category: "视频素材", title: "客户真实案例：腹胀 8 周改善记录", url: "https://example.com/case-bloat.mp4", desc: "真实前后对比，转化利器，推给犹豫客户。", tags: ["案例", "转化"], pushedTo: ["c_2"], createdAt: now - 40000000, region: "华南" },
    { id: "m_8", kind: "图文文章", category: "产品介绍", title: "乔本肠道管家服务包与权益", url: "https://mp.weixin.qq.com/s/example-package", desc: "三档会员权益说明，转化与复购用。", tags: ["服务包", "会员"], pushedTo: [], createdAt: now - 30000000, region: "通用" },
    { id: "m_9", kind: "图文文章", category: "功能文章", title: "肠道健康 7 天打卡图文", url: "", content: "Day1 多喝温水\nDay2 增加膳食纤维\nDay3 补充益生菌\nDay4 规律作息\nDay5 减少精制糖\nDay6 适度运动\nDay7 复测打卡", desc: "可转发朋友圈/社群的 7 天打卡图文，提升依从。", tags: ["打卡", "依从"], pushedTo: [], createdAt: now - 20000000, region: "通用" },
    { id: "m_10", kind: "图片海报", category: "品牌物料", title: "肠道年龄自测·分享海报", url: "https://example.com/poster-share.png", desc: "可下载转发朋友圈的分享海报。", tags: ["海报", "分享"], pushedTo: [], createdAt: now - 15000000, region: "华南" },
    { id: "m_11", kind: "活动方案", category: "活动", title: "肠道健康公益筛查活动方案", url: "https://example.com/activity-plan.pdf", desc: "社区公益筛查活动执行方案，含流程与分工。", tags: ["活动", "公益"], pushedTo: [], createdAt: now - 10000000, region: "华东" },
    { id: "m_12", kind: "案例图文", category: "案例", title: "客户案例：便秘 6 周改善图文", url: "", content: "客户 A，女，38 岁\n症状：长期便秘(2-3天/次)\n干预：益生菌+膳食纤维+饮食\n第 2 周：排便隔天一次\n第 6 周：每日规律，腹胀消失", desc: "前后对比案例图文，转化利器。", tags: ["案例", "转化"], pushedTo: [], createdAt: now - 5000000, region: "通用" },
  ];
  // 聊天消息：roomId = 'group'（项目总群）或 'dm_{memberId1}_{memberId2}'（1对1）
  const messages = [
    { id: "msg_1", roomId: "group", from: "m_beau", text: "各位，本周重点：完成招商政策 V1 定稿 + 招募首批省代 2 家。@林博士 请审核干预 SOP 的医学合规部分。", ts: now - 3600000 },
    { id: "msg_2", roomId: "group", from: "m_lin", "text": "收到，SOP 医学审核今天下午给反馈。另外建议在随访话术中增加「饮食执行度」评估维度。", ts: now - 3000 },
    { id: "msg_3", roomId: "group", from: "m_zhao", text: "好的，试点客户已招募到 12 人，本周目标 20 人。海岸城门店的转化率目前 32%，需要更多图文素材推送给犹豫客户。", ts: now - 2400 },
    { id: "msg_4", roomId: "dm_m_beau_m_zhao", from: "m_zhao", text: "beau，王女士（C_1）第 2 周随访做了，排便频率从 2→5 次/周，效果不错！要更新到案例库吗？", ts: now - 1800 },
    { id: "msg_5", roomId: "dm_m_beau_m_zhao", from: "m_beau", text: "太好了！更新吧，顺便让 AI 生成一条案例图文发到媒体库。", ts: now - 1200 },
  ];

  // 勋章系统：按成员记录成就
  const badges = [
    { id: "b_1", memberId: "m_beau", tier: "gold", icon: "🏆", name: "项目奠基人", desc: "创建乔本·数果 AI 项目工作台", earnedAt: now - 2000000000, category: "贡献" },
    { id: "b_2", memberId: "m_lin", tier: "silver", icon: "🧬", name: "知识构建者", desc: "创建 4 门专业课程", earnedAt: now - 80000000, category: "学习" },
    { id: "b_3", memberId: "m_zhao", tier: "bronze", icon: "🤝", name: "客户连接者", desc: "成功招募 12 名试点客户", earnedAt: now - 60000000, category: "运营" },
    { id: "b_4", memberId: "m_beau", tier: "diamond", icon: "⚡", name: "AI 先驱", desc: "首次使用 AI 自动执行并回写数据", earnedAt: now - 3600000, category: "创新" },
  ];

  // 用户系统：注册名 + 角色（user/editor/admin）
  const users = [
    { id: "u_beau", username: "beau", displayName: "beau（乔本）", role: "admin", createdAt: now },
  ];

  // 访问申请：用户申请编辑权限，管理员审批
  const accessRequests = [];

  return { members, plans, tasks, proposals, feedback, customers, experts, tools, aiTasks, docs, events, followups, reports, media, messages, badges, users, accessRequests, shares: [], meta: { project: "乔本·数果 AI 肠道健康管理项目", createdAt: now } };
}

function loadDB() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const db = JSON.parse(raw);
    for (const c of COLLECTIONS) if (!db[c]) db[c] = [];
    return db;
  } catch {
    const db = seed();
    for (const c of COLLECTIONS) if (!db[c]) db[c] = [];
    saveDB(db);
    return db;
  }
}
function saveDB(db) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
let DB = loadDB();

// ---------- 通用 CRUD 助手 ----------
function getCol(c) { return DB[c] || []; }
function find(c, id) { return getCol(c).find(x => x.id === id); }
function broadcast(msg) {
  const s = JSON.stringify(msg);
  wss.clients.forEach(cl => { if (cl.readyState === 1) cl.send(s); });
}
function logEvent(text, actor = "m_beau") {
  const ev = { id: "ev_" + nanoid(6), ts: Date.now(), actor, text };
  DB.events.unshift(ev);
  if (DB.events.length > 200) DB.events.length = 200;
  return ev;
}
function mutate(c, action, data, actor) {
  const ev = logEvent(data?.text || `${action} ${c}`, actor);
  saveDB(DB);
  broadcast({ type: "mutation", col: c, action, data, event: ev });
}

// ---------- Express ----------
const app = express();
app.use(express.json({ limit: "5mb" }));
// DEBUG: log all API requests
app.use("/api", (req, res, next) => { console.log(`[REQ] ${req.method} ${req.path}`); next(); });
// HTML 不缓存（保证发版即生效）；带 ?v= 的静态资源可长缓存
app.use(express.static(PUBLIC_DIR, {
  etag: true, lastModified: true, maxAge: 0,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    else if (filePath.endsWith(".png")) res.setHeader("Cache-Control", "public, max-age=604800");
  }
}));

// 文件上传（图片/视频/文档），存入 public/uploads，通过 /uploads/xxx 访问
fs.mkdirSync(path.join(PUBLIC_DIR, "uploads"), { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(PUBLIC_DIR, "uploads")),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || "";
      cb(null, Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ext);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});
app.post("/api/upload", upload.single("file"), (req, res) => {
  const auth = req.headers["authorization"] || "";
  const tok = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const payload = verifyToken(tok);
  if (!payload || !["editor", "admin"].includes(payload.role)) return res.status(403).json({ error: "仅协作者/管理员可上传" });
  if (!req.file) return res.status(400).json({ error: "未收到文件" });
  res.json({ url: "/uploads/" + req.file.filename, name: req.file.originalname, size: req.file.size });
});

// AI 多模态附件上传：任何登录成员可用，不公开，存入 data/ai-files
const aiFileUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AI_FILES_DIR),
    filename: (req, file, cb) => { cb(null, "af_" + nanoid(8) + "_" + file.originalname.replace(/[^\w.\-]/g, "_")); },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});
app.post("/api/ai/upload", aiFileUpload.single("file"), (req, res) => {
  const auth = req.headers["authorization"] || "";
  const tok = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const payload = verifyToken(tok);
  if (!payload) return res.status(401).json({ error: "未登录" });
  if (!req.file) return res.status(400).json({ error: "未收到文件" });
  const meta = { id: path.basename(req.file.filename).split("_")[1], name: req.file.originalname, path: req.file.path, size: req.file.size, kind: fileKindByExt(_ext(req.file.originalname)), by: payload.user, createdAt: Date.now() };
  const idx = path.join(AI_FILES_DIR, "index.json");
  let all = {}; try { all = JSON.parse(fs.readFileSync(idx, "utf8")); } catch {}
  all[meta.id] = meta; fs.writeFileSync(idx, JSON.stringify(all));
  res.json({ id: meta.id, name: meta.name, size: meta.size, kind: meta.kind });
});
// AI 附件文本提取（解析一次后缓存）
app.post("/api/ai/extract", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const idx = path.join(AI_FILES_DIR, "index.json");
  let all = {}; try { all = JSON.parse(fs.readFileSync(idx, "utf8")); } catch {}
  const out = [];
  for (const id of ids) {
    const meta = all[id]; if (!meta) { out.push({ id, error: "文件不存在" }); continue; }
    let cached = extractCacheGet(id);
    if (!cached) { cached = await extractFileText(meta.path); extractCachePut(id, { ...cached, at: Date.now() }); }
    out.push({ id, name: meta.name, kind: meta.kind, text: cached.text, chars: String(cached.text || "").length, engine: cached.engine || "", error: cached.error || "" });
  }
  res.json(out);
});

// 健康检查（公开，供 PaaS/容器探活）
app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------- 访问控制（注册 + 申请 → 审批） ----------
// 管理员列表：初始管理员可通过环境变量覆盖
const ADMIN_USERS = (process.env.ADMIN_USERS || "beau").split(",").map(s => s.trim()).filter(Boolean);
const AUTH_SECRET = process.env.AUTH_SECRET || "CHANGE_THIS_AUTH_SECRET_IN_PROD";
// 登录密码：必须由环境变量提供（部署时设置 MEMBER_PASSWORD / ADMIN_PASSWORD）。
// 以下仅为占位符，避免 Public 仓库泄露可用密码；未配置环境变量时登录一律失败。
const MEMBER_PASSWORD = process.env.MEMBER_PASSWORD || "CHANGE_MEMBER_PASSWORD";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CHANGE_ADMIN_PASSWORD";
const TOKEN_TTL = 1000 * 60 * 60 * 24 * 7; // 7 天

function makeToken(user, role) {
  const payload = Buffer.from(JSON.stringify({ user, role, exp: Date.now() + TOKEN_TTL })).toString("base64url");
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}
function verifyToken(tok) {
  if (!tok) return null;
  const [p, s] = tok.split(".");
  if (!p || !s) return null;
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(p).digest("base64url");
  if (sig !== s) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
function getUserRole(username) {
  const u = getCol("users").find(x => x.username === username);
  return u ? u.role : null;
}

// 计划级写权限：计划的 owner 或协助成员（collaborators），可编辑该计划及其下任务；创建者自动成为 owner
// 兼容成员 id 命名（登录用户名可能等于成员 id，或带 m_ 前缀）
function planTaskWriteAllowed(p, req) {
  const uid = req.auth.user;
  const ids = [uid, "m_" + uid];
  const m = String(p).match(/^\/(\w+)(?:\/([^/]+))?/);
  const col = m && m[1], id = m && m[2];
  const isOwner = (ownerId) => ids.includes(ownerId);
  const isCollab = (plan) => !!(plan && (isOwner(plan.ownerId) || (plan.collaborators || []).some(c => ids.includes(c))));
  if (col === "plans") {
    if (req.method === "POST") return true; // 创建者成为 owner
    const plan = getCol("plans").find(x => x.id === id);
    if (!plan) return false;
    if (req.method === "DELETE") return isOwner(plan.ownerId) || req.auth.role === "admin";
    return isCollab(plan);
  }
  if (col === "tasks") {
    if (req.method === "POST") {
      const pid = req.body && req.body.planId;
      return isCollab(getCol("plans").find(x => x.id === pid));
    }
    const t = getCol("tasks").find(x => x.id === id);
    if (!t) return false;
    if (req.method === "DELETE") return isOwner(t.ownerId) || req.auth.role === "admin";
    return isOwner(t.ownerId) || isCollab(getCol("plans").find(x => x.id === t.planId));
  }
  return false;
}

// 统一登录：名字 + 密码
//  - 管理员账号（ADMIN_USERS）+ 管理员密码 → admin，直接获得全部权限（免审批）
//  - 成员：任意名字 + 成员密码 → role=user（只读，自动建号并提交待审批申请）
//  - 已认证成员（editor/admin）用成员密码登录 → 维持其已有权限
// 移除黑名单：被管理员删除的成员名字禁止再登录建号
const DENIED_USERS = new Set(["lin", "zhao", "qian", "林博士", "赵运营", "钱产品"]);
//  - 其余 → 401
function tryLogin(username, password, displayName) {
  const name = String(username || "").trim();
  if (!name || name.length < 2) { const e = new Error("名字至少 2 个字符"); e.status = 400; throw e; }
  if (!password) { const e = new Error("请输入密码"); e.status = 400; throw e; }
  if (DENIED_USERS.has(name)) { const e = new Error("该成员已被移出团队，如需重新加入请联系管理员"); e.status = 403; throw e; }
  const isAdminName = ADMIN_USERS.includes(name);
  let role;
  if (isAdminName) {
    if (password === ADMIN_PASSWORD) role = "admin";
    else { const e = new Error("管理员密码错误"); e.status = 401; throw e; }
  } else {
    const existing = getCol("users").find(u => u.username === name);
    if (existing && ["editor", "admin"].includes(existing.role)) role = existing.role; // 已认证，维持
    else if (password === MEMBER_PASSWORD) role = "user";
    else { const e = new Error("密码错误"); e.status = 401; throw e; }
  }
  let user = getCol("users").find(u => u.username === name);
  let changed = false;
  if (!user) {
    user = { id: "u_" + nanoid(6), username: name, displayName: String(displayName || name).trim() || name, role, createdAt: Date.now() };
    DB.users.push(user);
    changed = true;
  } else if (role === "admin" && user.role !== "admin") {
    user.role = "admin"; changed = true;
  }
  if (changed) saveDB(DB);
  ensureMember(name, user.displayName);
  let requestStatus = role !== "user" ? "approved" : null;
  if (role === "user") { ensurePendingRequest(name, user.displayName); requestStatus = "pending"; }
  const token = makeToken(name, role);
  return { token, user: name, role, displayName: user.displayName, requestStatus, created: changed };
}

// 鉴权中间件：所有 /api/* 都需登录；写操作需 editor/admin 角色；审批操作在路由层单独校验
// 注册在「注册/登录」路由之前，确保 apply-access 等需登录接口能先拿到 req.auth
app.use("/api", (req, res, next) => {
  const p = req.path;
  // 公开接口：注册、登录、申请加入、在线状态、健康检查
  if (p === "/register" || p === "/login" || p === "/join" || p === "/presence" || p === "/health") return next();
  const auth = req.headers["authorization"] || "";
  const tok = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const payload = verifyToken(tok);
  if (!payload) { console.log(`[AUTH] ${req.method} ${p} -> 401 no token`); return res.status(401).json({ error: "未登录或登录已过期，请重新登录" }); }
  // 从数据库取最新角色（审批通过后角色可能已变）
  const latestRole = getUserRole(payload.user) || payload.role;
  payload.role = latestRole;
  req.auth = payload;
  console.log(`[AUTH] ${req.method} ${p} -> user=${payload.user} role=${latestRole}`);
  // 写操作需要 editor 或 admin；计划/任务额外允许 owner 与协助成员（数据实时共享、协作编辑）
  if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
    // /apply-access（申请编辑权限）与 /access-requests/*（审批）放行，角色在路由层校验
    const openWrite = p === "/apply-access" || p.startsWith("/access-requests") || p === "/me/rename";
    // 聊天是基础协作能力：消息发送/建群对全体登录成员开放（群解散在 col 层由群主/管理员校验）
    const chatWrite = p === "/messages" || p === "/chatRooms" || p.startsWith("/buddy") || /^\/messages\/|^\/chatRooms\//.test(p);
    // 想法库草稿是个人空间：全体登录成员可写自己的草稿（前端按 ownerId 过滤展示）
    const draftWrite = p === "/drafts" || p.startsWith("/drafts/");
    // 收件箱已读是个人操作：全体登录成员可标记自己的推送已读（全盘检查修复：原版成员会被拦成 403）
    const inboxRead = p.startsWith("/inbox/");
    if (!openWrite && !chatWrite && !draftWrite && !inboxRead && !["editor", "admin"].includes(latestRole)) {
      // 计划/任务：owner 或协助成员可在其参与范围内写入
      if (!planTaskWriteAllowed(p, req)) {
        return res.status(403).json({ error: "无修改权限：该计划/任务仅创建者或协助成员可编辑" });
      }
    }
    // 群解散/删除：仅群主或管理员
    const grp = p.match(/^\/chatRooms\/([\w-]+)$/);
    if (req.method === "DELETE" && grp) {
      const g = getCol("chatRooms").find(x => x.id === grp[1]);
      if (g && g.createdBy !== req.auth.user && g.createdBy !== "m_" + req.auth.user && latestRole !== "admin") {
        return res.status(403).json({ error: "仅群主或管理员可解散该群" });
      }
    }
  }
  next();
});

// 注册（公开）：名字 + 固定密码，自动建号并以只读身份登录；已存在则直接登录
app.post("/api/register", (req, res) => {
  try { res.json(tryLogin(req.body?.username, req.body?.password, req.body?.displayName)); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// 登录（公开）：名字 + 密码；管理员账号用管理员密码直接获得权限，成员用成员密码进入只读待审批
app.post("/api/login", (req, res) => {
  try { res.json(tryLogin(req.body?.username, req.body?.password, req.body?.displayName)); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// 确保某 WorkBuddy 名字对应一个成员（聊天/团队/负责人身份）
function ensureMember(username, displayName) {
  const id = "m_" + username;
  if (!getCol("members").find(m => m.id === id)) {
    DB.members.push({ id, name: displayName || username, role: "成员", color: pickColor(), online: false });
    saveDB(DB);
  }
  return id;
}

// 确保某用户有一条待审批的访问申请（不存在则创建），返回该申请
function ensurePendingRequest(username, displayName) {
  let ar = getCol("accessRequests").find(a => a.username === username && a.status === "pending");
  if (!ar) {
    ar = { id: "ar_" + nanoid(8), username, displayName: displayName || username, reason: "", status: "pending", requestedAt: Date.now(), reviewedBy: null, reviewedAt: null };
    DB.accessRequests.push(ar);
    saveDB(DB);
  }
  return ar;
}

// 申请加入（公开）：名字 + 固定密码，自动建号 + 申请访问（与登录同一入口，便于分享链接直接进）
app.post("/api/join", (req, res) => {
  try { res.json(tryLogin(req.body?.username, req.body?.password, req.body?.displayName)); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// 申请编辑权限（需登录）
app.post("/api/apply-access", (req, res) => {
  console.log("[APPLY-ACCESS] hit! auth=", !!req.auth, "user=", req.auth?.user, "body=", req.body);
  const username = req.auth?.user;
  if (!username) return res.status(401).json({ error: "未登录" });
  const user = getCol("users").find(u => u.username === username);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  if (user.role !== "user") return res.status(400).json({ error: "你已有编辑或管理员权限，无需申请" });
  // 检查是否已有待审批的申请
  const existing = getCol("accessRequests").find(a => a.username === username && a.status === "pending");
  if (existing) return res.status(200).json({ message: "已有待审批的申请", request: existing });
  const reqObj = { id: "ar_" + nanoid(8), username, displayName: user.displayName, reason: req.body?.reason || "", status: "pending", requestedAt: Date.now(), reviewedBy: null, reviewedAt: null };
  DB.accessRequests.push(reqObj);
  saveDB(DB);
  res.json({ message: "申请已提交，等待管理员审批", request: reqObj });
});

// 查看待审批列表（仅 admin）
app.get("/api/access-requests", (req, res) => {
  if (req.auth?.role !== "admin") return res.status(403).json({ error: "仅管理员可查看" });
  const pending = getCol("accessRequests").filter(a => a.status === "pending");
  const all = getCol("accessRequests");
  res.json({ pending, all });
});

// 审批通过（仅 admin）
app.post("/api/access-requests/:id/approve", (req, res) => {
  if (req.auth?.role !== "admin") return res.status(403).json({ error: "仅管理员可操作" });
  const ar = find("accessRequests", req.params.id);
  if (!ar) return res.status(404).json({ error: "申请不存在" });
  if (ar.status !== "pending") return res.status(400).json({ error: "该申请已处理" });
  ar.status = "approved";
  ar.reviewedBy = req.auth.user;
  ar.reviewedAt = Date.now();
  // 升级用户角色为 editor
  const user = getCol("users").find(u => u.username === ar.username);
  if (user) { user.role = "editor"; }
  saveDB(DB);
  res.json({ message: `已批准 ${ar.username} 的编辑权限`, request: ar });
});

// 审批拒绝（仅 admin）
app.post("/api/access-requests/:id/reject", (req, res) => {
  if (req.auth?.role !== "admin") return res.status(403).json({ error: "仅管理员可操作" });
  const ar = find("accessRequests", req.params.id);
  if (!ar) return res.status(404).json({ error: "申请不存在" });
  if (ar.status !== "pending") return res.status(400).json({ error: "该申请已处理" });
  ar.status = "rejected";
  ar.reviewedBy = req.auth.user;
  ar.reviewedAt = Date.now();
  saveDB(DB);
  res.json({ message: `已拒绝 ${ar.username} 的编辑权限申请`, request: ar });
});

// 自行修改名字（需登录）：可改显示名，也可改 WorkBuddy 名字（身份），并尽量重映射历史数据
function remapIdentity(oldName, newName) {
  const fix = (v) => {
    if (v === oldName) return newName;
    if (v === "m_" + oldName) return "m_" + newName;
    return v;
  };
  for (const col of COLLECTIONS) {
    if (col === "users") continue;
    for (const item of getCol(col)) {
      for (const k of Object.keys(item)) {
        if (typeof item[k] === "string") item[k] = fix(item[k]);
      }
    }
  }
  const mem = getCol("members").find(m => m.id === "m_" + oldName);
  if (mem) { mem.id = "m_" + newName; if (mem.name === oldName) mem.name = newName; }
}

app.post("/api/me/rename", (req, res) => {
  const oldName = req.auth?.user;
  if (!oldName) return res.status(401).json({ error: "未登录" });
  const user = getCol("users").find(u => u.username === oldName);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  const { displayName, newUsername } = req.body || {};
  if (displayName && String(displayName).trim()) user.displayName = String(displayName).trim();
  let changedName = false;
  if (newUsername && newUsername.trim() && newUsername.trim() !== oldName) {
    const nn = newUsername.trim();
    if (getCol("users").find(u => u.username === nn)) return res.status(409).json({ error: "该名字已被占用" });
    remapIdentity(oldName, nn);
    user.username = nn;
    changedName = true;
  }
  saveDB(DB);
  // 未审批（user 角色）用户：修改名字即（重新）向管理员提交访问申请
  let requestStatus = user.role !== "user" ? "approved" : null;
  if (user.role === "user") {
    ensurePendingRequest(user.username, user.displayName);
    requestStatus = "pending";
  }
  const token = makeToken(user.username, user.role);
  res.json({ token, user: user.username, role: user.role, displayName: user.displayName, changedName, requestStatus });
});

// 管理员提权/降权：把某个登录账号设为 admin（或降回 user）；账号不存在时自动建号（便于预授权）
app.post("/api/admin/set-role", (req, res) => {
  if (req.auth?.role !== "admin") return res.status(403).json({ error: "仅管理员可设置角色" });
  const { username, role } = req.body || {};
  if (!username || !["admin", "user", "editor"].includes(role)) return res.status(400).json({ error: "参数不合法" });
  let user = getCol("users").find(u => u.username === username);
  let created = false;
  if (!user) {
    const mem = getCol("members").find(m => m.id === "m_" + username);
    user = { id: "u_" + Math.random().toString(36).slice(2, 8).toUpperCase(), username, displayName: (mem && mem.name) || username, role, createdAt: Date.now() };
    getCol("users").push(user);
    created = true;
  } else {
    user.role = role;
  }
  saveDB(DB);
  console.log(`[ROLE] ${req.auth.user} 将 ${username} 设为 ${role}${created ? "（新建账号）" : ""}`);
  res.json({ ok: true, username, role, created, displayName: user.displayName });
});

// 推送（编辑/管理员）：把某条目推送给指定成员，进入对方收件箱
app.post("/api/push", (req, res) => {
  if (!["editor", "admin"].includes(req.auth?.role)) return res.status(403).json({ error: "仅协作者/管理员可推送" });
  const { collection, id, toUsernames, note } = req.body || {};
  if (!COLLECTIONS.includes(collection) || !id) return res.status(400).json({ error: "缺少目标条目" });
  const item = find(collection, id);
  if (!item) return res.status(404).json({ error: "条目不存在" });
  const targets = Array.isArray(toUsernames) ? toUsernames : (toUsernames ? [toUsernames] : []);
  if (!targets.length) return res.status(400).json({ error: "请选择接收成员" });
  const created = [];
  for (const tu of targets) {
    if (!getCol("users").find(u => u.username === tu)) continue;
    const sh = {
      id: "sh_" + nanoid(8), fromUsername: req.auth.user, toUsername: tu,
      collection, itemId: id, title: item.title || item.name || "（无标题）",
      note: note || "", createdAt: Date.now(), status: "unread",
    };
    DB.shares.push(sh); created.push(sh);
  }
  saveDB(DB);
  broadcast({ type: "mutation", col: "shares", action: "create", data: created });
  res.json({ ok: true, count: created.length, shares: created });
});

// 收件箱（当前用户收到的推送）
app.get("/api/inbox", (req, res) => {
  const u = req.auth?.user;
  if (!u) return res.status(401).json({ error: "未登录" });
  const list = getCol("shares").filter(s => s.toUsername === u).sort((a, b) => b.createdAt - a.createdAt);
  res.json({ list, unread: list.filter(s => s.status === "unread").length });
});

// 标记已读
app.post("/api/inbox/:id/read", (req, res) => {
  const u = req.auth?.user;
  if (!u) return res.status(401).json({ error: "未登录" });
  const sh = getCol("shares").find(s => s.id === req.params.id && s.toUsername === u);
  if (!sh) return res.status(404).json({ error: "不存在" });
  sh.status = "read";
  saveDB(DB);
  res.json({ ok: true, share: sh });
});

// 鉴权中间件已上移至「注册」路由之前（见下方），确保 apply-access 等路由先经过鉴权。

// 通用集合路由
for (const col of COLLECTIONS) {
  app.get(`/api/${col}`, (req, res) => res.json(getCol(col)));
  app.get(`/api/${col}/:id`, (req, res) => {
    const item = find(col, req.params.id);
    if (!item) return res.status(404).json({ error: "not found" });
    res.json(item);
  });
  app.post(`/api/${col}`, (req, res) => {
    const item = { id: col[0] + "_" + nanoid(8), ...req.body, _created: Date.now() };
    DB[col].push(item);
    mutate(col, "create", item, req.body._actor);
    res.json(item);
  });
  app.put(`/api/${col}/:id`, (req, res) => {
    const item = find(col, req.params.id);
    if (!item) return res.status(404).json({ error: "not found" });
    // 方案改版归档：内容变化时旧版本自动进 versions 历史，改版不丢内容
    if (col === "proposals" && req.body && typeof req.body.content === "string" && req.body.content !== item.content) {
      item.versions = Array.isArray(item.versions) ? item.versions : [];
      const oldV = Number(item.version) || 1;
      if (typeof item.content === "string" && item.content.trim() && !item.versions.some(v => v.v === oldV)) {
        item.versions.push({ v: oldV, content: item.content, note: req.body._versionNote || "", by: req.body._actor || item.createdBy, updatedAt: item.updatedAt || Date.now() });
      }
    }
    Object.assign(item, req.body, { id: item.id });
    if (item.updatedAt !== undefined) item.updatedAt = Date.now();
    mutate(col, "update", item, req.body._actor);
    res.json(item);
  });
  app.delete(`/api/${col}/:id`, (req, res) => {
    DB[col] = getCol(col).filter(x => x.id !== req.params.id);
    mutate(col, "delete", { id: req.params.id }, req.body?._actor);
    res.json({ ok: true });
  });
}

// 概览统计
app.get("/api/dashboard/stats", (req, res) => {
  const tasks = getCol("tasks");
  const statusCount = t => tasks.filter(x => x.status === t).length;
  res.json({
    plans: getCol("plans").length,
    tasksTotal: tasks.length,
    tasksDoing: statusCount("doing"),
    tasksDone: statusCount("done"),
    tasksTodo: statusCount("todo"),
    proposals: getCol("proposals").length,
    customers: getCol("customers").length,
    customersA: getCol("customers").filter(c => c.level === "A").length,
    feedback: getCol("feedback").length,
    aiTasks: getCol("aiTasks").filter(a => a.status !== "已完成").length,
    docs: getCol("docs").length,
    media: getCol("media").length,
    experts: getCol("experts").length,
    tools: getCol("tools").length,
    members: getCol("members").length,
  });
});

// AI 任务：交给猪猪侠处理（返回结构化 prompt，并预留 endpoint 调用）
app.post("/api/aiTasks/:id/run", (req, res) => {
  const a = find("aiTasks", req.params.id);
  if (!a) return res.status(404).json({ error: "not found" });
  a.status = "处理中";
  const payload = {
    project: DB.meta.project,
    task: a.title,
    prompt: a.prompt,
    context: { linkedType: a.linkedType, linkedId: a.linkedId },
  };
  mutate("aiTasks", "update", a, a.createdBy);
  res.json({ ok: true, payload, note: "请在 WorkBuddy / 猪猪侠 会话中粘贴此任务，结果回填到本页「结果」区。" });
});

// ---------- AI 内容生成引擎（本地模板引擎，基于乔本·数果业务知识生成结构化草稿） ----------
function aiKindOf(a) {
  const t = ((a.title || "") + " " + (a.prompt || "") + " " + (a.linkedType || "")).toLowerCase();
  if (a.linkedType === "proposal" || /商业计划书|\bbp\b|方案|计划书/.test(t)) return "proposal";
  if (a.linkedType === "doc" || /课程|培训|sop|知识库|学习|课件|讲义|考核/.test(t)) return "doc";
  if (a.linkedType === "customer" || /客户|画像|跟进|干预/.test(t)) return "customer";
  if (a.linkedType === "followup" || /随访|话术/.test(t)) return "followup";
  if (a.linkedType === "media" || /文案|图文|海报|视频|脚本|短视频|内容|素材|推文/.test(t)) return "media";
  if (a.linkedType === "task" || /任务|执行|排期|分解|wbs/.test(t)) return "task";
  if (a.linkedType === "report" || /报告|检测|指标维度/.test(t)) return "report";
  if (a.linkedType === "feedback" || /反馈|指标|统计|分析/.test(t)) return "feedback";
  return "generic";
}
function deriveTitle(prompt, kind) {
  const p = (prompt || "").replace(/\s+/g, " ").trim();
  if (p && p.length > 20) return p.slice(0, 20) + "…";
  return p || "AI 生成内容";
}
function genProposal(prompt, title) {
  const brief = prompt ? `**需求背景：** ${prompt}\n` : "";
  return `# ${(title || "肠道健康管理方案").replace(/^撰写方案：/, "")}\n\n> 本文由 AI 基于乔本·数果 AI 业务知识生成草稿，请人工复核后定稿。\n\n## 一、背景与目标\n${brief}面向肠道菌群失衡人群（便秘/IBS/代谢综合征），以「菌群检测 + AI 解读 + 个性化干预 + 随访闭环」为核心，提升客户依从与复购。\n\n## 二、核心策略\n1. **产品与服务包**：检测盒 + AI 解读报告 + 益生菌/膳食纤维/饮食干预方案 + 21 天随访。\n2. **渠道与招商**：B 端省代→市代→区代→门店→合伙人分级分润，统一培训与知识库。\n3. **C 端运营**：私域社群 + 随访时间线 + 复测对比，沉淀健康档案。\n\n## 三、执行步骤\n- 第 1 阶段（0-4 周）：完成产品定义、招商政策与首批试点招募。\n- 第 2 阶段（4-8 周）：跑通 20 人试点闭环，验证干预有效率与复购率。\n- 第 3 阶段（8 周后）：规模化复制，迭代 AI 能力与知识库。\n\n## 四、关键指标（KPI）\n- 试点干预有效率 ≥70%\n- C 端复购率 ≥40%\n- 单客 LTV 与回本周期达标\n\n## 五、风险与合规\n- 客户健康数据加密存储、授权同意、最小可用。\n- 招商不涉及多级返利，宣传不夸大收益。\n\n## 六、预算与资源（待填）\n- 人力、检测成本、市场费用。\n`;
}
function genDoc(prompt, title) {
  const t = title || deriveTitle(prompt, "doc");
  const topic = prompt || "本模块核心知识";
  const body = `## 课程目标\n学完本课程，学员能够理解 ${topic} 的核心逻辑，并能在乔本肠道管家的实际场景中正确执行。\n\n## 一、背景与定义\n肠道菌群由上千种微生物组成，厚壁菌门与拟杆菌门占主导。菌群失衡（dysbiosis）与便秘、腹胀、肠易激(IBS)、肥胖、代谢综合征密切相关。\n\n## 二、核心知识点\n1. 关键指标：菌群多样性、有益菌（双歧杆菌/乳酸杆菌）占比、条件致病菌水平。\n2. 干预三维：益生菌 + 膳食纤维 + 饮食调整。\n3. 服务闭环：测评 → 解读 → 干预 → 随访 → 反馈。\n\n## 三、标准流程与操作要点\n- 测评：健康问卷 + 肠道菌群检测。\n- 解读：AI 输出失衡维度评分与风险，专家双审。\n- 干预：个性化方案，21 天周期降低决策门槛。\n- 随访：第 2/4/8 周复测与调整。\n\n## 四、常见误区与合规红线\n- 不得夸大收益、不得涉及多级返利。\n- 健康数据需授权同意、加密存储。\n\n## 五、考核要点\n掌握指标解读与标准流程，能复述干预三维与随访节点。\n`;
  const quiz = [
    { q: "乔本肠道管家的标准服务闭环是？", options: ["测评→解读→干预→随访→反馈", "直接卖产品", "仅做检测"], answer: 0 },
    { q: "菌群失衡的英文术语是？", options: ["Symbiosis", "Dysbiosis", "Microbiota"], answer: 1 },
    { q: "以下哪项与肠道菌群失衡关联性较弱？", options: ["肠易激(IBS)", "肥胖/代谢综合征", "头发颜色"], answer: 2 },
  ];
  return { result: body, title: t, duration: 18, quiz };
}
function genCustomer(prompt, title) {
  return `**AI 客户画像与跟进建议**\n\n- 需求洞察：${prompt || "（未提供指令，基于通用场景生成）"}\n- 健康关注：便秘/腹胀/IBS 等肠道症状，关注个性化与依从性。\n- 价值分层建议：依据付费意愿与转介绍潜力评估 A/B/C 级。\n- 跟进节奏：解读后第 3/7/14/30 天四次触达。\n- 转化路径：测评 → 1v1 解读 → 方案购买 → 复购/转介绍。\n- 注意：绑定来源渠道（B 端），数据统一路径管理。\n`;
}
function genFollowup(prompt, title) {
  return `**随访记录（AI 起草）**\n${prompt ? "本次重点：" + prompt + "\n" : ""}- 症状复盘：排便频率/腹胀评分较基线变化。\n- 依从性：益生菌与膳食纤维执行情况。\n- 饮食执行：高纤维食谱与饮水达标度。\n- 不良反应：如有及时记录并处理。\n- 下一步：第 2/4/8 周复测安排与方案微调。\n`;
}
function genMedia(prompt, title) {
  return `**标题建议：** ${(title || "肠道健康科普")}\n\n**正文/文案：**\n${prompt || "分享一条肠道健康干货"}——\n\n① 你以为的"肠胃不好"可能藏在菌群里：菌群多样性下降、有益菌不足，会直接影响排便与腹胀。\n② 三个日常动作：多喝温水、增加膳食纤维、规律补充益生菌。\n③ 21 天一个小周期，让肠道慢慢回到正轨。\n\n#乔本肠道管家 #肠道菌群 #健康打卡\n`;
}
function genTask(prompt, title) {
  return `**任务说明（AI 起草）**\n${prompt ? "背景：" + prompt + "\n" : ""}**执行要点：**\n1. 明确交付物与验收标准。\n2. 拆解为可落地的子步骤，设定里程碑。\n3. 关联计划与目标，定期在「执行进度」推进并更新进度%。\n4. 风险点：资源/合规/跨部门协同，提前同步。\n`;
}
function genReport(prompt, title) {
  return `菌群多样性(Shannon),3.2,,≥3.8,偏低\n厚壁菌/拟杆菌比(F/B),1.4,,0.8-1.2,偏高\n双歧杆菌 相对丰度,1.5,%,≥3%,偏低\n乳酸杆菌 相对丰度,1.0,%,≥2%,偏低\n阿克曼菌 Akkermansia,0.4,%,≥0.5%,偏低\n短链脂肪酸(SCFA),低,,正常,偏低\n粪便钙卫蛋白(炎症),正常,,正常,正常`;
}
function genFeedback(prompt, title) {
  return `**AI 数据洞察建议**\n${prompt ? "针对：" + prompt + "\n" : ""}- 趋势：结合历史反馈看环比/同比变化。\n- 归因：区分渠道动销、门店转化与终端效果。\n- 行动：对异常指标（超期/下滑）设置预警与责任人。\n- 建议：将结论回填至对应任务与方案，形成数据→决策闭环。\n`;
}
function genGeneric(prompt, title) {
  return `# ${(title || "AI 生成内容")}\n\n> 由 AI 基于乔本·数果 AI 业务知识生成草稿。\n\n## 要点\n${prompt || ""}\n\n## 说明\n- 结合「菌群检测 + AI 解读 + 个性化干预 + 随访闭环」业务模型。\n- 涉及渠道分级、C 端运营、知识库与合规。\n- 请人工复核后落地。\n`;
}
function generateContent({ kind, prompt, title, linkedType }) {
  const k = kind || aiKindOf({ title, prompt, linkedType });
  const p = (prompt || "").trim();
  if (k === "doc") return genDoc(p, title);
  if (k === "proposal") return { result: genProposal(p, title) };
  if (k === "customer") return { result: genCustomer(p, title) };
  if (k === "followup") return { result: genFollowup(p, title) };
  if (k === "media") return { result: genMedia(p, title) };
  if (k === "task") return { result: genTask(p, title) };
  if (k === "report") return { result: genReport(p, title) };
  if (k === "feedback") return { result: genFeedback(p, title) };
  return { result: genGeneric(p, title) };
}

// ---------- AI 生成统一入口：全部直通 WorkBuddy 本体模型能力，本地模板兜底 ----------
// 说明：WorkBuddy 桌面端在本机启动 agent-cli 网关（discoverWorkBuddyGateway 动态发现），
// /api/v1/llm/completions 可启动真实 Agent（大模型 + 联网搜索等工具）。
// 网关不可用时回退到上方本地模板引擎，保证演示环境不中断。
const AI_KIND_SYSTEM = {
  proposal: "你是乔本·数果 AI 肠道健康管理项目的方案撰写专家。根据需求撰写商业方案/计划书草稿，Markdown 输出，包含：背景与目标、核心策略、执行步骤（含阶段排期）、关键指标 KPI、风险与合规、预算与资源。业务背景：菌群检测+AI解读+个性化干预（益生菌/膳食纤维/饮食）+随访闭环；B端渠道省代→市代→区代→门店→合伙人分级分润；随访节点第0/2/4/8周。招商不夸大收益、不承诺多级返利。",
  doc: "你是乔本·数果的知识库课程设计师。根据需求编写培训课程/知识库文档正文，Markdown 格式，包含：课程目标、背景与定义、核心知识点、标准流程与操作要点、常见误区与合规红线、考核要点。内容结合肠道菌群健康管理业务（测评→解读→干预→随访闭环）。",
  customer: "你是乔本·数果的客户运营专家。根据需求输出客户画像与跟进建议：需求洞察、健康关注点、价值分层（A/B/C级）、跟进节奏、转化路径、数据管理要点。",
  followup: "你是乔本·数果的随访助手。根据需求起草随访记录：症状复盘、依从性、饮食执行、不良反应、下一步安排（第2/4/8周复测与方案微调）。口吻专业温和。",
  media: "你是乔本·数果的新媒体内容专家。根据需求写文案/图文/短视频脚本：吸引人的标题、正文或分镜脚本、话题标签（#乔本肠道管家 等）、行动引导。风格亲切专业，适合私域与短视频平台。",
  task: "你是乔本·数果的项目管理助手。根据需求起草任务说明：背景、交付物与验收标准、可落地的子步骤与里程碑、关联计划与推进方式、风险点提示。",
  report: "你是乔本·数果的检测报告解读专家。根据需求输出菌群检测报告的指标解读与干预建议，用清晰的表格或分条列出指标、参考范围、实际状态与建议。",
  feedback: "你是乔本·数果的数据分析师。根据需求输出数据洞察：趋势（环比/同比）、归因（渠道动销/门店转化/终端效果）、行动建议（异常指标预警与责任人）、数据到决策的闭环建议。",
  generic: "你是乔本·数果 AI 肠道健康管理项目工作台的 AI 助理。根据需求生成结构化、可直接使用的中文草稿，结合「菌群检测+AI解读+个性化干预+随访闭环」业务模型。",
  "proposal-rewrite": "你是乔本·数果 AI 肠道健康管理项目的方案改写专家。你将收到一份方案原文和一条改写指令，请基于原文进行改写：保留原文整体结构与有价值的信息，严格按指令调整相应部分，其余部分保持连贯。输出完整改写后的方案全文（Markdown），不要输出改写说明、对比或寒暄，直接给成品。",
};
async function aiComplete(kind, prompt, title, attachments) {
  const gw = discoverWorkBuddyGateway();
  if (!gw) return null;
  try {
    const sys = (AI_KIND_SYSTEM[kind] || AI_KIND_SYSTEM.generic) + "\n直接输出成品内容本身，不要寒暄、不要解释、不要「以下是」之类前缀。";
    let q = (title ? "【标题/主题】" + title + "\n" : "") + "【需求】" + ((prompt || title || "").toString().trim() || "请生成相关内容草稿");
    q += fmtAttachments(attachments);
    const up = await fetch(gw + "/api/v1/llm/completions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userPrompt: q, systemPrompt: sys, maxTurns: 3 }),
    });
    const j = await up.json().catch(() => null);
    if (j && j.success === true && typeof j.text === "string" && j.text.trim()) return j.text.trim();
    return null;
  } catch { return null; }
}
async function aiGenerate(payload) {
  const p = payload || {};
  const k = p.kind || aiKindOf(p);
  const text = await aiComplete(k, p.prompt, p.title, p.attachments);
  if (text) {
    const out = { result: text, engine: AI_ENGINE() };
    if (k === "doc") { const t = genDoc(p.prompt, p.title); out.title = p.title || t.title; out.duration = t.duration; out.quiz = t.quiz; }
    return out;
  }
  return { ...generateContent(p), engine: "local-template" };
}

// 表单「AI 协助」：生成草稿（直通 WorkBuddy 模型，模板兜底）
app.post("/api/ai/generate", async (req, res) => {
  const body = req.body || {};
  const ids = Array.isArray(body.attachments) ? body.attachments : [];
  const attachments = [];
  if (ids.length) {
    const idx = path.join(AI_FILES_DIR, "index.json");
    let all = {}; try { all = JSON.parse(fs.readFileSync(idx, "utf8")); } catch {}
    for (const id of ids.slice(0, 6)) {
      const meta = all[id]; if (!meta) continue;
      let cached = extractCacheGet(id); if (!cached) { cached = await extractFileText(meta.path); extractCachePut(id, { ...cached, at: Date.now() }); }
      attachments.push({ name: meta.name, text: cached.text || "" });
    }
  }
  res.json(await aiGenerate({ ...body, attachments }));
});

// 方案 AI 改写：基于指定版本原文 + 改写指令 → 产出新版本候选。
// 不直接覆盖方案：由前端决定「存入想法库（私有打磨）」或「升版定稿（PUT 回写，自动归档旧版）」。
// 方案 AI 改写：基于指定版本原文 + 改写指令 → 产出新版本候选。
// 不直接覆盖方案：由前端决定「存入想法库（私有打磨）」或「升版定稿（PUT 回写，自动归档旧版）」。
app.post("/api/proposals/:id/rewrite", async (req, res) => {
  const p = find("proposals", req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  const instruction = String((req.body || {}).instruction || "").trim();
  if (!instruction) return res.status(400).json({ error: "请填写改写指令" });
  const vs = Array.isArray(p.versions) ? p.versions : [];
  const bv = Number((req.body || {}).baseVersion) || Number(p.version) || 1;
  const hist = vs.find(v => v.v === bv);
  const baseContent = hist ? hist.content : p.content;
  let prompt = "【改写指令】" + instruction + "\n\n【方案原文（v" + bv + "）】\n" + (baseContent || "（原文为空）");
  const ids = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  const attachments = [];
  if (ids.length) {
    const idx = path.join(AI_FILES_DIR, "index.json");
    let all = {}; try { all = JSON.parse(fs.readFileSync(idx, "utf8")); } catch {}
    for (const id of ids.slice(0, 6)) {
      const meta = all[id]; if (!meta) continue;
      let cached = extractCacheGet(id); if (!cached) { cached = await extractFileText(meta.path); extractCachePut(id, { ...cached, at: Date.now() }); }
      attachments.push({ name: meta.name, text: cached.text || "" });
    }
  }
  prompt += fmtAttachments(attachments);
  const text = await aiComplete("proposal-rewrite", prompt, p.title, attachments);
  if (text) return res.json({ result: text, engine: AI_ENGINE(), baseVersion: bv });
  // 本地兜底：网关不可用时给出可编辑的标记稿，保证流程不中断
  const fallback = (baseContent || "") + "\n\n---\n【AI 改写待完成 · 基于 v" + bv + "】\n改写指令：" + instruction + "\n（AI 网关暂不可用，已保留原文并标记指令，稍后可重新改写）";
  res.json({ result: fallback, engine: "local-template", baseVersion: bv });
});

// AI 任务台 / Buddy / 工具：一键自动执行，并把结果回写到对应数据/知识集合（数据相通）
app.post("/api/aiTasks/:id/autorun", async (req, res) => {
  const a = find("aiTasks", req.params.id);
  if (!a) return res.status(404).json({ error: "not found" });
  const k = aiKindOf(a);
  const ids = Array.isArray(a.attachmentIds) ? a.attachmentIds : [];
  const attachments = [];
  if (ids.length) {
    const idx = path.join(AI_FILES_DIR, "index.json");
    let all = {}; try { all = JSON.parse(fs.readFileSync(idx, "utf8")); } catch {}
    for (const id of ids.slice(0, 6)) {
      const meta = all[id]; if (!meta) continue;
      let cached = extractCacheGet(id); if (!cached) { cached = await extractFileText(meta.path); extractCachePut(id, { ...cached, at: Date.now() }); }
      attachments.push({ name: meta.name, text: cached.text || "" });
    }
  }
  const gen = await aiGenerate({ kind: k, prompt: a.prompt, title: a.title, linkedType: a.linkedType, attachments });
  a.status = "已完成";
  a.result = gen.result;
  a.updatedAt = Date.now();
  mutate("aiTasks", "update", a, a.createdBy);
  const actor = a.createdBy || "m_beau";
  let feedback = { collection: "aiTasks", label: "AI 任务结果" };
  if (k === "proposal") {
    if (a.linkedId && find("proposals", a.linkedId)) {
      const pr = find("proposals", a.linkedId); pr.content = gen.result; pr.updatedAt = Date.now();
      mutate("proposals", "update", pr, actor); feedback = { collection: "proposals", label: "方案" };
    } else {
      const pr = { id: "pr_" + nanoid(8), title: (a.title || "").replace(/^撰写方案：/, ""), content: gen.result, status: "草稿", version: 1, createdBy: actor, updatedAt: Date.now() };
      DB.proposals.push(pr); mutate("proposals", "create", pr, actor); feedback = { collection: "proposals", label: "方案（新草稿）" };
    }
  } else if (k === "doc") {
    if (a.linkedId && find("docs", a.linkedId)) {
      const d = find("docs", a.linkedId); d.body = gen.result; d.updatedAt = Date.now();
      mutate("docs", "update", d, actor); feedback = { collection: "docs", label: "学习库课程" };
    } else {
      const d = { id: "d_" + nanoid(8), title: gen.title || deriveTitle(a.prompt, "doc"), category: "总纲", type: "lesson", duration: gen.duration || 15, body: gen.result, quiz: gen.quiz || [], author: actor, updatedAt: Date.now(), progress: {} };
      DB.docs.push(d); mutate("docs", "create", d, actor); feedback = { collection: "docs", label: "学习库课程（新建）" };
    }
  } else if (k === "task") {
    if (a.linkedId && find("tasks", a.linkedId)) {
      const t = find("tasks", a.linkedId); t.desc = (t.desc ? t.desc + "\n\n" : "") + "【AI 执行要点】\n" + gen.result;
      mutate("tasks", "update", t, actor); feedback = { collection: "tasks", label: "任务说明" };
    }
  } else if (k === "customer" || k === "followup") {
    const cid = (a.linkedId && find("customers", a.linkedId)) ? a.linkedId : (getCol("customers").find(c => c.type === "C") || {}).id;
    if (cid) {
      const f = { id: "fu_" + nanoid(8), customerId: cid, date: new Date().toISOString().slice(0, 10), type: k === "followup" ? "AI随访" : "AI跟进", byMember: actor, content: gen.result };
      DB.followups.push(f); mutate("followups", "create", f, actor); feedback = { collection: "followups", label: "客户随访记录" };
    }
  } else if (k === "media") {
    if (a.linkedId && find("media", a.linkedId)) {
      const m = find("media", a.linkedId); m.content = gen.result; m.desc = m.desc || a.title;
      mutate("media", "update", m, actor); feedback = { collection: "media", label: "媒体库素材" };
    } else {
      const m = { id: "m_" + nanoid(8), kind: "图文文章", category: "AI生成", title: a.title || deriveTitle(a.prompt, "media"), content: gen.result, desc: a.title || "", tags: ["AI生成"], pushedTo: [], createdAt: Date.now() };
      DB.media.push(m); mutate("media", "create", m, actor); feedback = { collection: "media", label: "媒体库素材（新建）" };
    }
  } else {
    const pr = { id: "pr_" + nanoid(8), title: (a.title || "AI 分析") + "（自动）", content: gen.result, status: "草稿", version: 1, createdBy: actor, updatedAt: Date.now() };
    DB.proposals.push(pr); mutate("proposals", "create", pr, actor); feedback = { collection: "proposals", label: "方案（自动草稿）" };
  }
  res.json({ ok: true, task: a, feedback });
});

// 导出 / 导入（分享与备份）
app.get("/api/export", (req, res) => {
  if (!["editor", "admin"].includes(req.auth?.role)) return res.status(403).json({ error: "仅协作者/管理员可导出数据" });
  res.setHeader("Content-Disposition", "attachment; filename=qiaoben-shuguo-export.json");
  res.json(DB);
});
app.post("/api/import", (req, res) => {
  if (req.auth?.role !== "admin") return res.status(403).json({ error: "仅管理员可导入数据" });
  DB = { ...seed(), ...req.body };
  for (const c of COLLECTIONS) if (!DB[c]) DB[c] = [];
  saveDB(DB);
  broadcast({ type: "full-reload", db: DB });
  res.json({ ok: true });
});

// ---------- 肠道管家：内容自动生产线 ----------
// 角色：每日围绕肠道菌群 / 肠道保养主题全网检索素材 → AI 改稿成乔本风格 → 配图自动生成（规避版权）→ 写入文章库（media）
const GUT_TOPICS = [
  { t: "菌群多样性", kw: ["菌群多样性", "肠道健康"], pts: ["菌群多样性是肠道健康的「体检总分」，多样性越低越容易便秘、腹胀、免疫下滑", "长期外卖高油高糖、膳食纤维不足，是多样性下降的头号原因", "多样化饮食 + 发酵食品 + 规律作息，21 天就能感受到变化"] },
  { t: "益生菌怎么选", kw: ["益生菌", "菌株"], pts: ["选益生菌先看菌株号（如双歧杆菌 BB-12），再看活菌数与保质期活性", "不是数量越多越好，对症菌株比堆数量更重要", "益生菌要持续补 4 周以上，配合膳食纤维才能定植"] },
  { t: "膳食纤维", kw: ["膳食纤维", "益生元"], pts: ["膳食纤维是肠道有益菌的「口粮」，每天建议 25-30g，多数人只吃到一半", "粗粮、豆类、菌菇、深色蔬菜是四大高纤主力", "突然大幅加纤维容易胀气，建议每周递增、多喝水"] },
  { t: "发酵食品", kw: ["发酵食品", "酸奶"], pts: ["酸奶、泡菜、味噌、康普茶等发酵食品，每天一小份有助菌群多样化", "选购酸奶看「活性乳酸菌」和低糖，风味乳饮料不算数", "自制发酵食品注意卫生，避免杂菌污染"] },
  { t: "便秘调理", kw: ["便秘", "排便"], pts: ["每周排便 <3 次且费力才算便秘，偶尔一天不排不必焦虑", "蹲姿比坐姿更顺、晨起一杯温水能唤醒结肠蠕动", "长期依赖泻药会损伤肠道神经，调理要从菌群和饮食入手"] },
  { t: "肠脑轴", kw: ["肠脑轴", "情绪"], pts: ["肠道被称为「第二大脑」，约 90% 的血清素在肠道产生", "压力大、焦虑会通过肠脑轴影响菌群，菌群失衡也会放大坏情绪", "规律吃饭、充足睡眠、适度运动，是双向调节的关键"] },
  { t: "抗生素与菌群", kw: ["抗生素", "菌群失衡"], pts: ["抗生素是「无差别轰炸」，杀菌的同时也会误伤有益菌", "服用抗生素期间与之后，更需要补益生菌和膳食纤维帮助菌群重建", "务必遵医嘱足量足疗程，不要自行加减药"] },
  { t: "短链脂肪酸", kw: ["短链脂肪酸", "SCFA"], pts: ["短链脂肪酸（SCFA）是菌群发酵膳食纤维的产物，是肠道细胞的能量源", "SCFA 充足有助于肠道屏障稳固、抑制炎症", "多吃可发酵纤维（燕麦、豆类、香蕉）就是给 SCFA 生产线供原料"] },
  { t: "喝水与肠道", kw: ["饮水", "肠道"], pts: ["水分不足时肠道会过度吸收水分，大便变干变硬", "每天 1500-1700ml 水，少量多次比一次猛灌更有效", "晨起温水、餐前半小时补水，是对肠道最友好的时间点"] },
  { t: "运动与肠道", kw: ["运动", "肠道蠕动"], pts: ["每周 150 分钟中等强度运动，可显著改善肠道蠕动与菌群构成", "饭后散步 15 分钟比立刻躺平更养肠", "过度高强度训练反而可能短暂扰乱菌群，循序渐进即可"] },
  { t: "熬夜伤肠", kw: ["熬夜", "作息"], pts: ["肠道菌群也有生物钟，昼夜节律打乱会让菌群比例失衡", "连续熬夜后更容易便秘、胀气、食欲失控", "固定入睡时间 + 睡前 2 小时不进食，是给菌群的「下班时间」"] },
  { t: "肠龄自测", kw: ["肠龄", "自测"], pts: ["排便规律、腹胀频率、饮食多样性、睡眠质量，四个维度可以粗估肠龄", "肠龄比实际年龄老 10 岁以上，就该认真干预了", "乔本肠道管家提供专业菌群检测，可以给出精确的肠道年龄评分"] },
  { t: "腹胀胀气", kw: ["腹胀", "胀气"], pts: ["吃太快吞入空气、产气食物过多、菌群发酵异常，是胀气三大来源", "记录饮食日记，两周就能定位自己的「产气雷区」", "持续腹胀超过 2 周不缓解，建议做检测排除菌群失衡"] },
  { t: "免疫力与肠道", kw: ["免疫力", "肠道屏障"], pts: ["人体约 70% 的免疫细胞驻扎在肠道，菌群是免疫系统的「教官」", "菌群平衡训练免疫「打得准也不过激」，失衡则容易过敏或易感", "养好菌群 = 给免疫力打地基"] },
  { t: "减重与菌群", kw: ["减重", "代谢"], pts: ["研究发现胖瘦人群的菌群构成存在系统性差异（F/B 比）", "极端节食会「饿死」有益菌，反弹期菌群抢着囤能量", "高纤维 + 适量蛋白 + 发酵食品的减脂饮食，才是菌群友好的减重"] },
  { t: "儿童肠道健康", kw: ["儿童", "肠道"], pts: ["3 岁前是菌群定植黄金期，自然分娩、母乳喂养是第一波「菌」福利", "孩子挑食偏食，会早期固化单一的菌群结构", "儿童补益生菌需选儿童剂型菌株，先咨询医生"] },
  { t: "中老年肠道", kw: ["中老年", "肠道"], pts: ["年纪增长，双歧杆菌等有益菌自然衰减，便秘发生率上升", "牙口不好导致纤维摄入不足，是中老年肠道问题的隐形推手", "软烂高纤（燕麦粥、蒸南瓜、豆腐）+ 适度活动是解法"] },
  { t: "皮肤与肠道", kw: ["皮肤", "肠皮轴"], pts: ["「肠皮轴」：肠道菌群失衡引发的慢性炎症，会以痘痘、泛红形式上脸", "反复长痘但护肤无效的人，值得查一次菌群", "内调外养结合，皮肤问题才不容易复发"] },
  { t: "深夜进食", kw: ["夜宵", "进食时间"], pts: ["深夜进食违背菌群昼夜节律，同样的食物晚上吃更「胖肠」", "夜宵偏好高油高糖，等于专门喂有害菌", "实在饿，选无糖酸奶或一小把坚果"] },
  { t: "益生菌与益生元", kw: ["益生菌", "益生元"], pts: ["益生菌是「活菌本菌」，益生元是「菌的食物」，合生元是两者组合", "只补菌不喂饭，菌株很难定植；两者搭配效果更好", "香蕉、洋葱、大蒜、燕麦里就有天然益生元"] },
];
const GUT_HOOKS = ["很多人不知道的是：", "别再忽视了：", "一篇讲清楚：", "今天聊聊：", "顺手科普：", "看完少走弯路："];
const todayStr = () => new Date().toISOString().slice(0, 10);
// 自动生成 SVG 封面（自己生成，规避图片版权问题）
function genGutCover(title, seed) {
  const palettes = [["#1e9e6a", "#7be0b0"], ["#2f6bff", "#8ec2ff"], ["#7c5cff", "#c9b8ff"], ["#e8833a", "#ffd0a8"]];
  const [c1, c2] = palettes[seed % palettes.length];
  const short = (title || "肠道健康").slice(0, 12);
  const esc2 = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="1200" height="675" fill="url(#g)"/>
<circle cx="1050" cy="120" r="180" fill="#ffffff" opacity="0.12"/><circle cx="150" cy="600" r="140" fill="#ffffff" opacity="0.10"/>
<text x="600" y="290" font-size="120" text-anchor="middle">🦠</text>
<text x="600" y="430" font-size="56" font-weight="bold" text-anchor="middle" fill="#ffffff" font-family="PingFang SC, Microsoft YaHei, sans-serif">${esc2(short)}</text>
<text x="600" y="500" font-size="30" text-anchor="middle" fill="#ffffff" opacity="0.85" font-family="PingFang SC, sans-serif">乔本肠道管家 · AI 创作</text>
</svg>`;
  const file = "butler-cover-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6) + ".svg";
  fs.writeFileSync(path.join(PUBLIC_DIR, "uploads", file), svg);
  return "/uploads/" + file;
}
// 产出 1 篇文章（主题轮换去重：全部用过则按时间最久未用的主题复用）
async function gutButlerRun(actor) {
  const used = new Set(getCol("media").filter(m => m.butler && typeof m.butlerTopic === "number").map(m => m.butlerTopic));
  let topicIdx = GUT_TOPICS.findIndex((_, i) => !used.has(i));
  if (topicIdx < 0) {
    // 全部主题已用过：取肠道管家文章中最早使用的主题（最久未更新，可复用）
    const butler = getCol("media").filter(m => m.butler).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    topicIdx = butler.length ? butler[0].butlerTopic : 0;
  }
  const tp = GUT_TOPICS[topicIdx] || GUT_TOPICS[0];
  const hook = GUT_HOOKS[Date.now() % GUT_HOOKS.length];
  const title = `${hook}关于${tp.t}，这 3 点最值得知道`;
  // 内容直通 WorkBuddy 模型改稿（检索+创作），失败回退本地模板
  const aiText = await aiComplete("media",
    `围绕「${tp.t}」写一篇乔本风格肠道健康科普图文（公众号/小红书风格），标题已定为《${title}》。\n必须覆盖的要点：\n1. ${tp.pts[0]}\n2. ${tp.pts[1]}\n3. ${tp.pts[2]}\n结构要求：吸引人的开头 → 三个核心要点（展开讲透）→ 乔本小贴士（测评→解读→干预→随访闭环）→ 打卡建议 → 文末注明科普不能替代诊疗。`,
    title);
  const content = aiText || [
    `【${tp.t} · 乔本风格科普】`,
    "",
    `很多人以为肠道问题离自己很远，其实 ${tp.pts[0].slice(0, 18)}……今天用 3 分钟讲清楚「${tp.t}」。`,
    "",
    "一、核心要点",
    `1. ${tp.pts[0]}`,
    `2. ${tp.pts[1]}`,
    `3. ${tp.pts[2]}`,
    "",
    "二、乔本小贴士",
    "· 肠道调理讲究「测评 → 解读 → 干预 → 随访」的闭环，盲目跟风补剂往往事倍功半。",
    "· 21 天是肠道菌群更新的一个小周期，坚持记录感受，变化会给你反馈。",
    "· 如有持续不适（便血、体重骤降、长期腹痛），请及时就医，科普不能替代诊疗。",
    "",
    "三、打卡建议",
    "今天起连续 7 天：每天 1 份高纤维食物 + 1500ml 水 + 固定入睡时间，在群里打卡互相监督。",
    "",
    "———",
    "本文由「肠道管家」围绕全网科普主题检索改稿生成（乔本风格），配图由 AI 自动生成，无版权风险。发布前建议经内容合规审核。",
  ].join("\n");
  const m = {
    id: "m_" + nanoid(8),
    kind: "图文文章", category: "健康知识", title,
    url: genGutCover(title, topicIdx),
    content, desc: `肠道管家自动产出：${tp.t}主题科普，${tp.kw.join("/")}。`,
    tags: ["肠道管家", "AI改稿", ...tp.kw],
    pushedTo: [], createdAt: Date.now(), region: "通用",
    butler: true, butlerTopic: topicIdx, butlerDate: todayStr(),
  };
  DB.media.unshift(m);
  mutate("media", "create", m, actor || "m_beau");
  logEvent(`肠道管家自动产出文章素材《${title}》`, actor || "m_beau");
  return m;
}
// 手动触发（编辑者/管理员）
app.post("/api/ai/gut-butler/run", async (req, res) => {
  const m = await gutButlerRun(req.auth ? "m_" + req.auth.user : "m_beau");
  res.json({ ok: true, media: m, todayCount: getCol("media").filter(x => x.butler && x.butlerDate === todayStr()).length });
});
// 状态查询
app.get("/api/ai/gut-butler/status", (req, res) => {
  const butler = getCol("media").filter(m => m.butler);
  res.json({ total: butler.length, today: butler.filter(m => m.butlerDate === todayStr()).length, topics: GUT_TOPICS.length, lastTitle: butler[0]?.title || null });
});
// 每日自动干活：每小时整点检查，当天尚未产出则自动产 1 篇
setInterval(() => {
  try {
    const today = getCol("media").filter(m => m.butler && m.butlerDate === todayStr()).length;
    if (!today) {
      gutButlerRun("m_beau").then(m => {
        console.log(`[肠道管家] 今日自动产出：《${m.title}》`);
      }).catch(e => console.error("[肠道管家] 自动产出失败:", e.message));
    }
  } catch (e) { console.error("[肠道管家] 自动产出失败:", e.message); }
}, 60 * 60 * 1000);

// ---------- 助理Buddy：直通 WorkBuddy（猪猪侠）本体 AI 能力 ----------
// 原理：WorkBuddy 桌面主程序会在本机 127.0.0.1 随机端口启动 agent-cli gateway，
// 其中 POST /api/v1/llm/completions 免鉴权（仅本机可访问），可启动真实 Agent
// （模型 + 联网搜索等工具）一次性应答。端口随 WorkBuddy 重启而变化，
// 因此每次请求时扫描 ~/.workbuddy/sessions/*.json 动态发现常驻 host 网关。
// 可用环境变量 BUDDY_GATEWAY_URL 强制指定（如 http://127.0.0.1:49426）。
const AI_ENGINE = () => (process.env.AI_BACKEND === "dsh" ? "dsh" : "workbuddy");
const BUDDY_SYSTEM = `你是「助理Buddy」，乔本·数果 AI 肠道健康管理项目工作台里的全能 AI 助理，背后直通 WorkBuddy 的完整 AI 能力（大模型 + 联网搜索等工具）。
业务背景：项目以「菌群检测 + AI 解读 + 个性化干预（益生菌/膳食纤维/饮食）+ 随访闭环」为核心服务；B 端渠道为 省代→市代→区代→门店→合伙人 分级分润，C 端做会员订阅与私域运营；随访节点第 0/2/4/8 周。
你的能力：写作（方案/计划书/话术/文案/短视频脚本）、分析（数据/客户/市场）、答疑（肠道健康科普/项目业务/系统使用）、头脑风暴，用户问什么答什么，不限定格式。
回答要求：直接给结果，中文，简洁有条理；健康科普注明「不能替代诊疗」；涉及招商不夸大收益、不承诺多级返利。`;
// AI 引擎开关（DSH 移植版）：
//   AI_BACKEND=dsh  —— 走 DSH 内置模型路由（AI 桥插件在 http://127.0.0.1:3080/qb-ai，见 DSH_AI_URL）
//   AI_BACKEND=workbuddy（默认）—— 走 WorkBuddy 桌面网关（原逻辑）
// 两者对上层完全透明：都是 POST {userPrompt, systemPrompt, maxTurns} → {success, text}。
function discoverWorkBuddyGateway() {
  if (process.env.AI_BACKEND === "dsh") {
    return (process.env.DSH_AI_URL || "http://127.0.0.1:3080/qb-ai").replace(/\/+$/, "");
  }
  if (process.env.BUDDY_GATEWAY_URL) return process.env.BUDDY_GATEWAY_URL.replace(/\/+$/, "");
  try {
    const dir = path.join(process.env.HOME || process.env.USERPROFILE || ".", ".workbuddy", "sessions");
    const now = Date.now();
    const cands = fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        // 只挑常驻 host 网关（sessionId 形如 interactive-<pid>，心跳 60 秒内视为存活）
        if (j.endpoint && /^interactive-\d+$/.test(j.sessionId || "") && now - (j.lastHeartbeat || 0) < 60000) return j;
      } catch {}
      return null;
    }).filter(Boolean).sort((a, b) => (b.lastHeartbeat || 0) - (a.lastHeartbeat || 0));
    return cands[0]?.endpoint || null;
  } catch { return null; }
}
// ---------- 助理Buddy：持久记忆（跨会话/刷新保留对话，按用户分档） ----------
const BUDDY_MEM_FILE = path.join(__dirname, "data", "buddy-memory.json");
function buddyMemAll() {
  try { return JSON.parse(fs.readFileSync(BUDDY_MEM_FILE, "utf8")); } catch { return {}; }
}
function buddyMemWrite(all) {
  try {
    fs.mkdirSync(path.dirname(BUDDY_MEM_FILE), { recursive: true });
    fs.writeFileSync(BUDDY_MEM_FILE, JSON.stringify(all));
  } catch (e) { console.log("[Buddy] 记忆写入失败:", e.message); }
}
app.get("/api/buddy/history", (req, res) => {
  res.json(buddyMemAll()[req.auth.user] || []);
});
app.put("/api/buddy/history", (req, res) => {
  const msgs = (Array.isArray(req.body?.messages) ? req.body.messages : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, 20000), ...(m.docId ? { docId: m.docId } : {}), ...(m.planId ? { planId: m.planId } : {}), ...(m.draftId ? { draftId: m.draftId } : {}) }))
    .slice(-100);
  const all = buddyMemAll();
  all[req.auth.user] = msgs;
  buddyMemWrite(all);
  res.json({ ok: true, count: msgs.length });
});
app.delete("/api/buddy/history", (req, res) => {
  const all = buddyMemAll();
  delete all[req.auth.user];
  buddyMemWrite(all);
  res.json({ ok: true });
});
app.post("/api/buddy/chat", async (req, res) => {
  const history = (Array.isArray(req.body?.messages) ? req.body.messages : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20);
  if (!history.some(m => m.role === "user")) return res.status(400).json({ error: "请输入内容" });
  const gateway = discoverWorkBuddyGateway();
  if (!gateway) {
    return res.status(503).json({ error: "AI 引擎未就绪：请确认 DSH（AI_BACKEND=dsh）或 WorkBuddy 桌面端（AI_BACKEND=workbuddy）正在运行。" });
  }
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
  const send = (obj) => res.write("data: " + JSON.stringify(obj) + "\n\n");
  try {
    // 一次性 Agent 无多轮记忆，把历史对话压平进 userPrompt
    let q = history.length > 1
      ? "【历史对话】\n" + history.slice(0, -1).map(m => (m.role === "user" ? "用户：" : "助理：") + m.content).join("\n") + "\n\n【当前问题】\n" + history[history.length - 1].content
      : history[0].content;
    // 解析附件并追加到当前问题
    const ids = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    const attachments = [];
    if (ids.length) {
      const idx = path.join(AI_FILES_DIR, "index.json");
      let all = {}; try { all = JSON.parse(fs.readFileSync(idx, "utf8")); } catch {}
      for (const id of ids.slice(0, 6)) {
        const meta = all[id]; if (!meta) continue;
        let cached = extractCacheGet(id); if (!cached) { cached = await extractFileText(meta.path); extractCachePut(id, { ...cached, at: Date.now() }); }
        attachments.push({ name: meta.name, text: cached.text || "" });
      }
    }
    q += fmtAttachments(attachments);
    const up = await fetch(gateway + "/api/v1/llm/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userPrompt: q, systemPrompt: BUDDY_SYSTEM, maxTurns: 4 }),
    });
    const j = await up.json().catch(() => null);
    if (!j || j.success !== true || typeof j.text !== "string" || !j.text.trim()) {
      send({ error: "WorkBuddy 应答失败：" + ((j && j.error) || "HTTP " + up.status) });
      return res.end();
    }
    // 分段推送，前端呈现打字机效果
    const text = j.text;
    for (let i = 0; i < text.length; i += 60) {
      send({ delta: text.slice(i, i + 60) });
      await new Promise(r => setTimeout(r, 30));
    }
  } catch (e) {
    send({ error: "调用失败：" + (e.message || "网络异常") });
  }
  res.end();
});

// ---------- WebSocket 实时同步 ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const presence = new Map(); // ws -> member info
wss.on("connection", (ws) => {
  ws.on("message", (m) => {
    let msg; try { msg = JSON.parse(m); } catch { return; }
    if (msg.type === "presence") {
      presence.set(ws, { id: msg.memberId, name: msg.name });
      broadcast({ type: "presence", members: [...presence.values()] });
    }
  });
  ws.on("close", () => {
    presence.delete(ws);
    broadcast({ type: "presence", members: [...presence.values()] });
  });
});

// 在线成员查询
app.get("/api/presence", (req, res) => res.json([...presence.values()]));

server.listen(PORT, HOST, () => {
  console.log(`乔本·数果 AI 工作台已启动: http://${HOST}:${PORT}`);
});
