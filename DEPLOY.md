# 乔本·数果 AI — Render 云端部署详细步骤

> 适用仓库：`beaujiang88/qiaoben-shuguo-ai`（Public）
> 应用：Node(Express) + WebSocket，数据存 JSON 文件 `DATA_FILE`

---

## 0. 邮箱验证（你当前在这步）
- 打开 **jiangbeau1@gmail.com**，查收 Render 发来的 "Verify your email" 邮件。
- 点击邮件里的验证链接（或复制到浏览器打开）。
- 完成后访问 https://dashboard.render.com 登录。

---

## 1. 推送最新代码（本地已 commit `2163e57`，需 push）
`render.yaml` 已更新（加入了密码环境变量 + 磁盘配置），需先推到 GitHub，Render 才能拉到：
```bash
cd qiaoben-shuguo-ai
git push origin main
```
（remote 要求凭据时，用你的 GitHub Fine-grained token 作为密码。）

---

## 2. 新建 Web Service
- 登录 dashboard → 右上 **New → Web Service**。
- 选择 **Connect a repository** → 授权 GitHub → 选 `beaujiang88/qiaoben-shuguo-ai`。
  （若列表里看不到仓库，点 "Configure account" 安装 Render GitHub App 并勾选该仓库。）
- 页面字段：
  - **Name**：`qiaoben-shuguo-ai`
  - **Language**：`Docker`（已自动识别，无需改）
  - **Branch**：`main`
  - **Region**：能选 **Singapore** 就选（国内访问更快），否则保持 Oregon
  - **Instance Type**：见下方第 3 步决策
- ⚠️ 你这是**手动创建**流程，render.yaml 里的环境变量**不会自动填入**，请按第 4 步手动添加。

---

## 3. 实例类型与数据持久化（重要决策）
| 类型 | 价格 | 持久磁盘 | 休眠 | 适合 |
|------|------|----------|------|------|
| **Free** | $0 | ❌ 不支持 | 15 分钟无访问后休眠，唤醒慢 | 仅临时试用 |
| **Starter** | $7/月 | ✅ 支持 | 不强制休眠 | 正式协作（推荐） |

- 你的应用**所有数据都在 JSON 文件里**。Free 实例没有持久磁盘，文件系统是临时的 → 每次休眠/重启/重新部署都会丢数据。
- **数据重要 → 选 Starter**；只想先试 → Free（接受丢数据，定期用应用内"导出"备份）。

---

## 4. 填写环境变量（关键安全步骤）
手动创建流程不会自动带变量，点 **Add Environment Variable** 逐个加：

| Key | Value | 说明 |
|-----|-------|------|
| `AUTH_SECRET` | 终端跑 `openssl rand -hex 32` 生成 | 覆盖代码默认泄露值 |
| `MEMBER_PASSWORD` | 你自己设的强成员密码 | 覆盖默认 `qbsh2026@` |
| `ADMIN_PASSWORD` | 你自己设的强管理员密码 | 覆盖默认 `3612047Beau` |
| `ADMIN_USERS` | `beau` | 管理员登录名 |
| `DATA_FILE` | Starter 挂盘时填 `/data/db.json`；Free 留空用默认 `./data/db.json` | 数据文件路径 |
| `PORT` | `8080`（可留空，Render 会注入） | 可选 |
| `HOST` | `0.0.0.0` | 可选 |

> ⚠️ **仓库是 Public**，`server.js` 里 `MEMBER_PASSWORD` / `ADMIN_PASSWORD` / `AUTH_SECRET` **仍是硬编码默认值**（已泄露）。必须靠上面这些环境变量覆盖，否则任何人用泄露密码都能登录。

---

## 5. 持久磁盘（仅 Starter）
Service 创建后 → 左侧 **Disks** → **Add Disk**：
- Name: `qiaoben-data`
- Mount Path: `/data`
- Size: `1 GB`
确认环境变量 `DATA_FILE=/data/db.json`。首次启动 server.js 会自动在 `/data` 初始化空数据库。

（Free 实例这步做不了，跳过；数据存临时文件系统。）

---

## 6. 创建并等待部署
- 点 **Create Web Service** → 自动 build（约 1–3 分钟）。
- 看 **Logs / Events**：出现 "乔本·数果 AI 工作台已启动" 或 health check 通过即成功。
- 访问：`https://qiaoben-shuguo-ai.onrender.com`

---

## 7. 验证登录
- **管理员**：用户名 `beau` + 你设的 `ADMIN_PASSWORD` → 直接全部权限（免审批）。
- **成员**：任意名字 + 你设的 `MEMBER_PASSWORD` → 只读，需管理员审批才解锁。

---

## 注意事项
- Free 会休眠、冷启动慢、数据不持久（见第 3 步）。
- 云端是**全新空库**；本地数据不会自动同步。需迁移时，登录后用应用内"导出/导入"（导入仅管理员）。
- 想彻底杜绝默认密码泄露：把 `server.js` 的默认值改成"必须从环境变量读取，否则拒绝启动"（可让猪猪侠帮你改）。

---

## Railway 备选（可选）
仓库已带 `railway.json`。Railway 免费层（绑卡验证后）**支持 Volume 且不强制休眠**，更适合协作文档类应用：
- New Project → Deploy from GitHub repo → 选仓库。
- Variables 加：`AUTH_SECRET` / `MEMBER_PASSWORD` / `ADMIN_PASSWORD` / `ADMIN_USERS=beau` / `DATA_FILE=/data/db.json`。
- 加 Volume 挂到 `/data`。
- 部署后访问 Railway 分配的域名。
