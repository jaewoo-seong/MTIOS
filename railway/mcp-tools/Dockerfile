FROM node:22-alpine AS runner
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
EXPOSE 3002
CMD ["npm", "run", "start:mcp"]
