# bujo app. Node 22, runs the TypeScript sources through tsx (a dev dependency, so npm ci installs all of them).
#   docker build -t bujo .
FROM node:22-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    BUJO_DB=/data/bujo.db

WORKDIR /app

COPY package.json package-lock.json ./
# --include=dev: NODE_ENV=production above would otherwise skip tsx, which npm start needs.
RUN npm ci --ignore-scripts --include=dev

COPY tsconfig.json ./
COPY src ./src
COPY public ./public

# The database lives in /data, a volume. The photo of a page is never written anywhere.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["npm", "start"]
