# Запасной вариант приложения на Timeweb: Docker с собственным Caddy (если в панели нельзя править веб-сервер).
# Сборка: dist собирается скриптом, затем копируется вместе с Caddyfile.
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN node scripts/build-dist.js

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80
