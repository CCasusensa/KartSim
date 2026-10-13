@echo off
rem Stop KartSim (docker-start.cmd). Data stays in the Docker volumes; "docker compose down -v" deletes it.
cd /d "%~dp0"
if exist .env (
  docker compose down
) else (
  set MYSQL_ROOT_PASSWORD=x
  set KART_MYSQL_PASSWORD=x
  set KART_REDIS_PASSWORD=x
  set KART_CLUSTER_SECRET=x
  docker compose down
)
echo KartSim stopped. Data is kept.
pause
