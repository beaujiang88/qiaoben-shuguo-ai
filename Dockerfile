# 乔本·数果 AI 工作台 — 部署镜像（零数据库依赖）
FROM node:20-alpine

WORKDIR /app

# 先装依赖（利用层缓存）
COPY package.json ./
RUN npm install --omit=dev

# 拷贝应用
COPY . .

# 数据持久化目录（运行时把宿主机目录挂到 /app/data）
RUN mkdir -p /app/data

ENV PORT=3088
EXPOSE 3088

CMD ["node", "server.js"]
