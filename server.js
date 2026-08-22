// 乔本·数果 AI 肠道健康管理项目 — 后端服务
// Node + Express + ws；JSON 文件做共享数据库；WebSocket 做实时多人同步
import express from "express";
import crypto from "crypto";
import { WebSocketServer } from "ws";
import { nanoid } from "nanoid";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3088;
// 云端部署：绑定全部网卡（0.0.0.0），由 PaaS/容器映射外部端口
const HOST = process.env.HOST || "0.0.0.0";

// 头像配色（新成员自动分配）
const MEMBER_COLORS = ["#7c5cff", "#1e9e6a", "#e8833a", "#2f80ed", "#e0533d", "#16a085", "#8e44ad", "#d35400"];
function pickColor() { return MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)]; }

// ---------- 共享数据库（JSON 文件） ----------
const COLLECTIONS = [
  "members", "plans", "tasks", "proposals", "feedback",
  "customers", "experts", "tools", "aiTasks", "docs", "events",
  "followups", "reports", "media", "messages", "badges",
  "users", "accessRequests", "shares"
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
    { id: "e_1", name: "林博士", domain: "肠道微生态 / 临床营养", desc: "10 年菌群干预研究，主导方案医学审核", color: "#1e9e6a" },
    { id: "e_2", name: "周教授", domain: "消化内科", desc: "三甲医院科主任，顾问", color: "#7c5cff" },
  ];
  const tools = [
    { id: "tl_1", name: "菌群检测报告解读", category: "AI 分析", desc: "上传检测报告，AI 输出菌群失衡解读与干预建议", link: "", skill: "菌群报告解读", connectorId: "报告解读连接器", connected: true, expertId: "e_1" },
    { id: "tl_2", name: "饮食推荐引擎", category: "AI 干预", desc: "根据菌群与目标生成个性化食谱", link: "", skill: "个性化食谱", connectorId: "食谱生成连接器", connected: false, expertId: "" },
    { id: "tl_3", name: "随访自动提醒", category: "运营", desc: "按计划推送随访与复测提醒", link: "", skill: "随访提醒", connectorId: "随访提醒连接器", connected: true, expertId: "e_1" },
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
    { id: "m_1", kind: "文章", category: "功能文章", title: "肠道菌群与情绪：脑肠轴揭秘", url: "https://mp.weixin.qq.com/s/example-brain-gut", desc: "科普脑肠轴如何双向影响情绪与消化，适合推给压力型便秘客户。", tags: ["脑肠轴", "情绪", "便秘"], pushedTo: [], createdAt: now - 90000000, region: "通用" },
    { id: "m_2", kind: "文章", category: "功能文章", title: "21 天肠道调理食谱大全", url: "https://mp.weixin.qq.com/s/example-diet", desc: "高纤维食谱 + 发酵食物清单，干预期客户每日可参考。", tags: ["食谱", "膳食纤维"], pushedTo: [], createdAt: now - 80000000, region: "通用" },
    { id: "m_3", kind: "知识", category: "健康知识", title: "益生菌正确服用指南", url: "https://mp.weixin.qq.com/s/example-probiotic", desc: "服用时间、水温、与抗生素间隔等注意事项，降低客户误操作。", tags: ["益生菌", "依从性"], pushedTo: ["c_1"], createdAt: now - 70000000, region: "通用" },
    { id: "m_4", kind: "图片", category: "图片素材", title: "门店陈列海报·肠道年龄自测", url: "https://example.com/poster-gut-age.png", desc: "到店引流主视觉，扫码自测肠道年龄。", tags: ["门店", "海报", "引流"], pushedTo: [], createdAt: now - 60000000, region: "华南" },
    { id: "m_5", kind: "图片", category: "图片素材", title: "菌群检测报告样例(脱敏)", url: "https://example.com/report-sample.png", desc: "给潜在客户看的脱敏样本，建立专业信任。", tags: ["检测", "样本"], pushedTo: [], createdAt: now - 55000000, region: "通用" },
    { id: "m_6", kind: "视频", category: "视频素材", title: "乔本肠道管家·品牌介绍短片", url: "https://example.com/brand-intro.mp4", desc: "60s 品牌故事，适合朋友圈/社群首触。", tags: ["品牌", "介绍"], pushedTo: [], createdAt: now - 50000000, region: "全国" },
    { id: "m_7", kind: "视频", category: "视频素材", title: "客户真实案例：腹胀 8 周改善记录", url: "https://example.com/case-bloat.mp4", desc: "真实前后对比，转化利器，推给犹豫客户。", tags: ["案例", "转化"], pushedTo: ["c_2"], createdAt: now - 40000000, region: "华南" },
    { id: "m_8", kind: "文章", category: "产品介绍", title: "乔本肠道管家服务包与权益", url: "https://mp.weixin.qq.com/s/example-package", desc: "三档会员权益说明，转化与复购用。", tags: ["服务包", "会员"], pushedTo: [], createdAt: now - 30000000, region: "通用" },
    { id: "m_9", kind: "图文", category: "功能文章", title: "肠道健康 7 天打卡图文", url: "", content: "Day1 多喝温水\nDay2 增加膳食纤维\nDay3 补充益生菌\nDay4 规律作息\nDay5 减少精制糖\nDay6 适度运动\nDay7 复测打卡", desc: "可转发朋友圈/社群的 7 天打卡图文，提升依从。", tags: ["打卡", "依从"], pushedTo: [], createdAt: now - 20000000, region: "通用" },
    { id: "m_10", kind: "海报", category: "品牌物料", title: "肠道年龄自测·分享海报", url: "https://example.com/poster-share.png", desc: "可下载转发朋友圈的分享海报。", tags: ["海报", "分享"], pushedTo: [], createdAt: now - 15000000, region: "华南" },
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
app.use(express.static(PUBLIC_DIR));

// 健康检查（公开，供 PaaS/容器探活）
app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------- 访问控制（注册 + 申请 → 审批） ----------
// 管理员列表：初始管理员可通过环境变量覆盖
const ADMIN_USERS = (process.env.ADMIN_USERS || "beau").split(",").map(s => s.trim()).filter(Boolean);
const AUTH_SECRET = process.env.AUTH_SECRET || "qiaoben-shuguo-ai-secret-2026";
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
  // 写操作需要 editor 或 admin；申请/审批类接口由路由层自行校验角色
  if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
    // /apply-access（申请编辑权限）与 /access-requests/*（审批）放行，角色在路由层校验
    const openWrite = p === "/apply-access" || p.startsWith("/access-requests") || p === "/me/rename";
    if (!openWrite && !["editor", "admin"].includes(latestRole)) {
      return res.status(403).json({ error: "无修改权限：请先申请并获得编辑权限" });
    }
  }
  next();
});

// 注册（公开）：用 WorkBuddy 注册名创建账号
app.post("/api/register", (req, res) => {
  const { username, displayName } = req.body || {};
  const name = String(username || "").trim();
  if (!name || name.length < 2) return res.status(400).json({ error: "用户名至少 2 个字符" });
  if (getCol("users").find(u => u.username === name)) return res.status(409).json({ error: "用户名已被注册" });
  const user = { id: "u_" + nanoid(6), username: name, displayName: String(displayName || name).trim(), role: "user", createdAt: Date.now() };
  DB.users.push(user);
  saveDB(DB);
  const token = makeToken(name, "user");
  res.json({ token, user: name, role: "user", message: "注册成功，已以只读身份登录" });
});

// 登录（公开）：用注册名登录
app.post("/api/login", (req, res) => {
  const { username } = req.body || {};
  const name = String(username || "").trim();
  if (!name) return res.status(400).json({ error: "请输入用户名" });
  const user = getCol("users").find(u => u.username === name);
  if (!user) return res.status(401).json({ error: "用户不存在，请先注册", needRegister: true });
  const token = makeToken(name, user.role);
  res.json({ token, user: name, role: user.role, displayName: user.displayName });
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

// 申请加入（公开）：输入 WorkBuddy 名字即身份，自动建号 + 申请访问
// 老用户直接登录；新用户建号并进入只读，待管理员审批后获得编辑权限
app.post("/api/join", (req, res) => {
  const { username, displayName } = req.body || {};
  const name = String(username || "").trim();
  if (!name || name.length < 2) return res.status(400).json({ error: "名字至少 2 个字符" });
  let user = getCol("users").find(u => u.username === name);
  let created = false;
  if (!user) {
    user = { id: "u_" + nanoid(6), username: name, displayName: String(displayName || name).trim() || name, role: "user", createdAt: Date.now() };
    DB.users.push(user);
    ensureMember(name, user.displayName);
    created = true;
    saveDB(DB);
  } else {
    ensureMember(name, user.displayName);
  }
  // 申请访问状态：新成员（role=user）自动建一条待审批申请
  let requestStatus = user.role !== "user" ? "approved" : null;
  if (user.role === "user") {
    ensurePendingRequest(name, user.displayName);
    requestStatus = "pending";
  }
  const token = makeToken(name, user.role);
  res.json({ token, user: name, role: user.role, displayName: user.displayName, requestStatus, created });
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

// 表单「AI 协助」：生成草稿
app.post("/api/ai/generate", (req, res) => {
  res.json(generateContent(req.body || {}));
});

// AI 任务台 / Buddy / 工具：一键自动执行，并把结果回写到对应数据/知识集合（数据相通）
app.post("/api/aiTasks/:id/autorun", (req, res) => {
  const a = find("aiTasks", req.params.id);
  if (!a) return res.status(404).json({ error: "not found" });
  const k = aiKindOf(a);
  const gen = generateContent({ kind: k, prompt: a.prompt, title: a.title, linkedType: a.linkedType });
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
      const m = { id: "m_" + nanoid(8), kind: "图文", category: "AI生成", title: a.title || deriveTitle(a.prompt, "media"), content: gen.result, desc: a.title || "", tags: ["AI生成"], pushedTo: [], createdAt: Date.now() };
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
