# 乔本·数果 AI 工作台 — 容器镜像
FROM node:22-alpine

WORKDIR /app

# 先装依赖（利用层缓存）
COPY package*.json ./
RUN npm install --omit=dev

# 复制应用代码
COPY . .

# 运行时数据挂载到 /data（务必在运行时挂卷，否则容器销毁数据丢失）
ENV PORT=8080 \
    HOST=0.0.0.0 \
    AUTH_SECRET=qiaoben-shuguo-ai-secret-2026 \
    DATA_FILE=/data/db.json

EXPOSE 8080

# 健康检查（PaaS / 编排探活）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/api/health || exit 1

CMD ["node", "server.js"]
