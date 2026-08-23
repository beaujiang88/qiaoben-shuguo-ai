#!/bin/bash
# 乔本·数果AI 工作台 — 本地一键启动（Mac + Cloudflare Tunnel）
# 用途：Mac 重启或进程掉线后，跑一次本脚本即可恢复「本地服务 + 公网隧道」。
# 说明：若想开机自动常驻，推荐在真实 Terminal 用 launchd（见下）；本脚本是可手动触发的最简兜底。
set -e
PROJ="/Users/beaujiang/WorkBuddy/2026-08-22-22-17-09/qiaoben-shuguo-ai"
NODE="/Users/beaujiang/.workbuddy/binaries/node/versions/22.22.2/bin/node"
CF="/Users/beaujiang/.local/bin/cloudflared"

# 1) Node 服务（端口 3088；.env 在同目录，密钥已覆盖；macOS 原生提取 textutil/JXA/sips 依赖本机）
if lsof -ti :3088 >/dev/null 2>&1; then
  echo "• Node 已在 3088 运行，跳过"
else
  cd "$PROJ" && nohup "$NODE" server.js > /tmp/qiaoben-server.log 2>&1 &
  echo "• 已启动 Node 服务"
fi

# 2) Cloudflare Tunnel（命名隧道 qiaoben，固定域名 qiaoben.vnan.top，config 见 ~/.cloudflared/config.yml）
if pgrep -f "cloudflared tunnel run qiaoben" >/dev/null 2>&1; then
  echo "• Tunnel 已在运行，跳过"
else
  nohup "$CF" tunnel run qiaoben > /tmp/qiaoben-tunnel.log 2>&1 &
  echo "• 已启动 Tunnel"
fi

sleep 5
echo "—— 健康检查 ——"
curl -s -o /dev/null -w "本地 127.0.0.1:3088 -> %{http_code}\n" http://127.0.0.1:3088/ || true
curl -s -o /dev/null -w "公网 qiaoben.vnan.top -> %{http_code}\n" --max-time 20 https://qiaoben.vnan.top/ || true

# ===== 可选：开机自动常驻（在真实 Terminal，非本脚本）=====
# 先停掉手动进程，避免端口冲突：
#   pkill -f "server.js" ; pkill -f "cloudflared tunnel run qiaoben"
# 再让 launchd 接管（plist 已就绪）：
#   UID=$(id -u)
#   launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.qiaoben.server.plist
#   launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.qiaoben.tunnel.plist
