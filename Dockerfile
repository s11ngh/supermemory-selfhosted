FROM node:22-slim AS build

WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-slim

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./

ENV NODE_ENV=production
EXPOSE 8787

# Run migrations then start the server
CMD ["sh", "-c", "node dist/migrate.js && node dist/index.js"]
