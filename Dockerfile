# Docker-вариант приложения Timeweb: ветка timeweb-docker (её собирает workflow deploy-dist.yml).
# В корне ветки лежат этот Dockerfile, Caddyfile и site/ (готовый dist). Сборки node внутри образа нет.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY site /srv
EXPOSE 80
