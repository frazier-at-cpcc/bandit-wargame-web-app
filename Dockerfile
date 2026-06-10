FROM node:20-slim

# openssh-client (ssh), sshpass (inject password), and node-pty build deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-client sshpass python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/app.js"]
