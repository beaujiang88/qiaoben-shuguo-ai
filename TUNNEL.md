# 本地 Mac + Cloudflare Tunnel 部署手册

> 适用：想零成本、数据 100% 留在本机、给团队一个公网可访问地址。
> 前提：Mac 保持开机、不自动睡眠（接电 + 系统设置→电池→「防止自动睡眠」）。
> 当前本地服务已跑在 `http://localhost:3088`（HTTP 200）。

---

## 第 1 步：安装 cloudflared（本机无 Homebrew，用官方二进制）

```bash
# 1) 看芯片架构：arm64 = Apple 芯片，x86_64 = Intel
uname -m

# 2) 下载（按上面结果二选一）
#    Apple 芯片：
curl -L -o /tmp/cloudflared.tgz https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz
#    Intel：
# curl -L -o /tmp/cloudflared.tgz https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz

# 3) 解压并装到系统路径
tar xzf /tmp/cloudflared.tgz -C /tmp
sudo mv /tmp/cloudflared /usr/local/bin/
rm -f /tmp/cloudflared.tgz

# 4) 验证
cloudflared --version
```

---

## 第 2 步：快速隧道（立即可用，URL 每次重启会变）

不需要登录，一条命令拿公网地址：

```bash
cloudflared tunnel --url http://localhost:3088
```

终端会打印类似：

```
Your quick Tunnel has been assigned this URL: https://xxxx.trycloudflare.com
```

把这个 `https://xxxx.trycloudflare.com` 发给团队即可访问。
- 优点：零配置、秒开。
- 缺点：**每次重启命令，URL 都变**（临时隧道）。`Ctrl+C` 即关闭。

---

## 第 3 步：命名隧道（固定 URL，团队长期使用推荐）

临时隧道的 URL 会变，团队用很烦。命名隧道给你一个**固定地址**，但需要免费 Cloudflare 账号。

### 3.1 注册免费 Cloudflare 账号
https://dash.cloudflare.com/sign-up （免费，无需绑卡）。

### 3.2 登录（会弹浏览器授权）
```bash
cloudflared login
```

### 3.3 创建隧道
```bash
cloudflared tunnel create qiaoben
```
记下输出的隧道 ID。凭证会存到 `~/.cloudflared/<id>.json`。

### 3.4 拿到固定地址（二选一）

**方案 A — 你有域名（最稳，推荐）**
1. 把你的域名（如 `yourdomain.com`）加到 Cloudflare（免费 DNS）。
2. 一键建 DNS 记录指向隧道：
   ```bash
   cloudflared tunnel route dns qiaoben qiaoben.yourdomain.com
   ```
3. 固定地址就是 `https://qiaoben.yourdomain.com`（永久不变）。

**方案 B — 没有域名（用 Cloudflare 免费子域）**
命名隧道不绑定自有域名时，仍走 `*.trycloudflare.com` 随机子域，URL 不固定。
→ 没域名又想要固定地址，最便宜是买个 `$10/年` 域名挂 Cloudflare（方案 A）。否则回到第 2 步用快速隧道。

### 3.5 写配置文件 `~/.cloudflared/config.yml`
```yaml
tunnel: qiaoben
credentials-file: /Users/beaujiang/.cloudflared/<上面记的ID>.json
ingress:
  - hostname: qiaoben.yourdomain.com   # 方案 A 填你的域名；方案 B 这行删掉
    service: http://localhost:3088
  - service: http_status:404
```

### 3.6 以常驻方式运行命名隧道
```bash
cloudflared tunnel run qiaoben
```
（配合第 4 步的 launchd，可开机自启、崩溃自拉。）

---

## 第 4 步：让服务常驻（关键，否则重启 Mac 就挂）

Cloudflare Tunnel 和 Node 服务都只是前台进程，重启 Mac 或退出终端就停。用 macOS 自带的 `launchd` 让它们开机自启、挂了自动重启。

### 4.1 Node 服务常驻
写 plist（把路径改成你的实际路径）：

```bash
cat > ~/Library/LaunchAgents/com.qiaoben.server.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.qiaoben.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/beaujiang/.workbuddy/binaries/node/versions/22.22.2/bin/node</string>
    <string>/Users/beaujiang/WorkBuddy/2026-08-22-22-17-09/qiaoben-shuguo-ai/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/beaujiang/WorkBuddy/2026-08-22-22-17-09/qiaoben-shuguo-ai</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/qiaoben-server.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/qiaoben-server.err</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.qiaoben.server.plist
```

### 4.2 cloudflared 常驻（命名隧道模式）
```bash
cat > ~/Library/LaunchAgents/com.qiaoben.tunnel.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.qiaoben.tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/cloudflared</string>
    <string>tunnel</string>
    <string>run</string>
    <string>qiaoben</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/qiaoben-tunnel.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/qiaoben-tunnel.err</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.qiaoben.tunnel.plist
```

> 快速隧道模式（`--url`）不适合 launchd 常驻，建议用命名隧道再走 4.2。

---

## 第 5 步：安全（必须做）

仓库是 **Public**，`server.js` 里 `MEMBER_PASSWORD` / `ADMIN_PASSWORD` / `AUTH_SECRET` 的默认值已泄露。本机运行也要覆盖：

```bash
# 生成强随机密钥
openssl rand -hex 32
```
在 `server.js` 同目录建 `.env`（已被 .gitignore 忽略）或在 launchd 的 plist 里加 `EnvironmentVariables`：
```
AUTH_SECRET=<上面生成的串>
MEMBER_PASSWORD=<你设的成员密码>
ADMIN_PASSWORD=<你设的管理员密码>
ADMIN_USERS=beau
```
这样即使仓库公开，也没人能用默认密码登录。

---

## 第 6 步：把公网地址写进 README

拿到固定 URL（命名隧道）或当前快速 URL 后，替换 `README.md` 里的访问地址，团队就能直接点开。
- 成员登录：任意名字 + `MEMBER_PASSWORD`（只读，需审批）
- 管理员登录：`beau` + `ADMIN_PASSWORD`（直接有权限）

---

## 日常运维

| 操作 | 命令 |
|------|------|
| 看 Node 服务日志 | `tail -f /tmp/qiaoben-server.log` |
| 看隧道日志 | `tail -f /tmp/qiaoben-tunnel.log` |
| 重启 Node 服务 | `launchctl kickstart -k gui/$(id -u)/com.qiaoben.server` |
| 停隧道 | `launchctl unload ~/Library/LaunchAgents/com.qiaoben.tunnel.plist` |
| 手动起隧道（调试） | `cloudflared tunnel --url http://localhost:3088` |

---

## 快速隧道 vs 命名隧道 怎么选

- **只想马上给团队一个能打开的链接** → 第 2 步，30 秒搞定（URL 会变，重发一次即可）。
- **团队长期使用、URL 不能变** → 第 3 步命名隧道 + 第 4 步常驻（有域名最省心）。
