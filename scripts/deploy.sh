#!/usr/bin/env bash
#
# deploy.sh — Deploy de producción para reportes.edutecno.com
# ============================================================
# Despliega el API (Node + PM2) y el Frontend (Vite) del proyecto
# moodle-reports en el servidor de producción.
#
# Flujo:
#   1. Pull del branch 'prod' en ambos repos (aborta si hay cambios locales).
#   2. Instala dependencias (npm ci) en API y Frontend.
#   3. Build del Frontend (Vite -> dist/).
#   4. Backup del web root actual y publica el nuevo build (rsync).
#   5. Republica el proceso PM2 'reportes-api' desde ecosystem.config.js y
#      verifica que corre el árbol que acaba de compilar.
#
# Diseñado con extremo cuidado para NO afectar otros apps/servicios:
#   - Nunca usa 'pm2 restart all'; toca únicamente el proceso por nombre.
#   - No recarga nginx (no hace falta para archivos estáticos).
#   - Respalda el build anterior y revierte si la publicación falla.
#   - Aborta ante cualquier error (set -euo pipefail) y ante repos "sucios".
#   - Usa un lock para impedir deploys simultáneos.
#
# Este script vive DENTRO del repo del API (moodle-api-proxy/scripts/) para que
# llegue al servidor con el mismo 'git pull' que el código, en vez de copiarse a
# mano. Las rutas se deducen de su propia ubicación: si el proyecto cambia de
# sitio no hay nada que editar.
#
# Uso:   sudo bash /var/www/moodle-reports/moodle-api-proxy/scripts/deploy.sh
#
# Overrides opcionales por variable de entorno:
#   BASE_DIR  FRONT_DIR  WEB_ROOT  PM2_APP  BRANCH  API_PORT  KEEP_BACKUPS
# ------------------------------------------------------------------------

set -euo pipefail

# ─── Rutas deducidas de la ubicación de este script ─────────────────────
# .../moodle-api-proxy/scripts/deploy.sh  ->  API_DIR = .../moodle-api-proxy
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Auto-copia: este script vive en el repo que él mismo actualiza ─────
# bash lee el script de forma incremental, así que si 'git pull' lo reescribe a
# mitad del deploy podría ejecutar líneas mezcladas de dos versiones. Nos
# copiamos a un temporal y continuamos desde ahí, con las rutas originales.
if [[ "${DEPLOY_SELF_COPY:-}" != "1" ]]; then
  _self_copy="$(mktemp /tmp/deploy-reportes.XXXXXX)"
  cat "${BASH_SOURCE[0]}" > "$_self_copy"
  DEPLOY_SELF_COPY=1 DEPLOY_SCRIPT_DIR="$SCRIPT_DIR" exec bash "$_self_copy" "$@"
fi
trap 'rm -f "$0"' EXIT                    # borra la copia temporal al terminar
SCRIPT_DIR="${DEPLOY_SCRIPT_DIR:-$SCRIPT_DIR}"

API_DIR="$(dirname "$SCRIPT_DIR")"

# ─── Configuración ──────────────────────────────────────────────────────
BASE_DIR="${BASE_DIR:-$(dirname "$API_DIR")}"
FRONT_DIR="${FRONT_DIR:-$BASE_DIR/moodle-dashboard-app}"
WEB_ROOT="${WEB_ROOT:-/var/www/reportes.edutecno.com}"
PM2_APP="${PM2_APP:-reportes-api}"
BRANCH="${BRANCH:-prod}"
BUILD_SUBDIR="dist"                       # Vite genera dist/
BACKUP_DIR="$BASE_DIR/.deploy-backups"
LOG_DIR="$BASE_DIR/.deploy-logs"
KEEP_BACKUPS="${KEEP_BACKUPS:-5}"
ECOSYSTEM="$API_DIR/ecosystem.config.js"  # define la ruta que ejecuta PM2
API_PORT="${API_PORT:-3600}"              # el que espera el proxy_pass de nginx
EXPECTED_EXEC="$API_DIR/$BUILD_SUBDIR/index.js"

# ─── Detección de color (antes de redirigir la salida) ──────────────────
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BLUE=$'\033[1;34m'; C_GREEN=$'\033[1;32m'
  C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'
else
  C_RESET=""; C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""
fi

# ─── Logs: todo queda registrado en un archivo con timestamp ────────────
mkdir -p "$LOG_DIR" "$BACKUP_DIR"
LOG_FILE="$LOG_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

# ─── Lock: impide que dos deploys corran a la vez ───────────────────────
exec 9>"$BASE_DIR/.deploy.lock"
if ! flock -n 9; then
  echo "ERROR: ya hay un deploy en curso. Abortando." >&2
  exit 1
fi

# ─── Helpers de log ─────────────────────────────────────────────────────
step() { echo -e "\n${C_BLUE}==> $*${C_RESET}"; }
ok()   { echo -e "${C_GREEN}OK  $*${C_RESET}"; }
warn() { echo -e "${C_YELLOW}!   $*${C_RESET}"; }
die()  { echo -e "${C_RED}ERR $*${C_RESET}" >&2; exit 1; }

START_TS=$(date +%s)
echo -e "${C_BLUE}=== Deploy reportes.edutecno.com — $(date) ===${C_RESET}"
echo "Log: $LOG_FILE"

# ─── ¿El proceso PM2 está 'online'? (parseo robusto de JSON con node) ───
is_online() {
  pm2 jlist 2>/dev/null | node -e '
    const fs = require("fs");
    let app;
    try {
      const data = JSON.parse(fs.readFileSync(0, "utf8"));
      app = data.find(p => p.name === process.argv[1]);
    } catch (e) { process.exit(1); }
    process.exit(app && app.pm2_env && app.pm2_env.status === "online" ? 0 : 1);
  ' "$PM2_APP"
}

# ─── Ruta del script que PM2 está ejecutando realmente ──────────────────
# Clave para no repetir el fallo del 2026-08-10: PM2 corría
# /var/www/reportes-api/dist/index.js mientras el deploy compilaba
# /var/www/moodle-reports/moodle-api-proxy. El restart decía "online" y
# levantaba el código viejo, así que los deploys del API no hacían nada.
pm2_exec_path() {
  pm2 jlist 2>/dev/null | node -e '
    const fs = require("fs");
    try {
      const data = JSON.parse(fs.readFileSync(0, "utf8"));
      const app = data.find(p => p.name === process.argv[1]);
      process.stdout.write(app && app.pm2_env ? String(app.pm2_env.pm_exec_path || "") : "");
    } catch (e) { process.stdout.write(""); }
  ' "$PM2_APP"
}

# ─── 0. Preflight: comandos y rutas necesarias ──────────────────────────
step "Verificando entorno"
for cmd in git node npm pm2 rsync flock curl; do
  command -v "$cmd" >/dev/null 2>&1 || die "Falta el comando requerido: $cmd"
done
[[ -d "$API_DIR/.git" ]]   || die "No es un repo git: $API_DIR"
[[ -d "$FRONT_DIR/.git" ]] || die "No es un repo git: $FRONT_DIR"
[[ -d "$WEB_ROOT" ]]       || die "No existe el web root: $WEB_ROOT"
[[ -f "$API_DIR/.env" ]]   || die "Falta $API_DIR/.env (token de Moodle, MONGODB_URI, ...)"

CURRENT_EXEC="$(pm2_exec_path)"
if [[ -z "$CURRENT_EXEC" ]]; then
  warn "PM2 todavía no conoce el proceso '$PM2_APP'; se creará desde $ECOSYSTEM"
elif [[ "$CURRENT_EXEC" != "$EXPECTED_EXEC" ]]; then
  warn "PM2 está ejecutando OTRO árbol:"
  warn "  actual:   $CURRENT_EXEC"
  warn "  esperado: $EXPECTED_EXEC"
  warn "Se recreará el proceso apuntando al árbol que gestiona este script."
fi
ok "Entorno OK"

# ─── Función: actualizar un repo de forma segura ────────────────────────
update_repo() {
  local dir="$1" name="$2"
  step "[$name] Actualizando repo (branch $BRANCH)"
  cd "$dir"

  local current_branch
  current_branch=$(git rev-parse --abbrev-ref HEAD)
  [[ "$current_branch" == "$BRANCH" ]] \
    || die "[$name] está en '$current_branch', no en '$BRANCH'. Cámbialo a mano con cuidado."

  # No pisar cambios locales en producción.
  if ! git diff --quiet || ! git diff --cached --quiet; then
    die "[$name] tiene cambios locales sin commitear. Resuélvelos antes del deploy."
  fi

  local before after
  before=$(git rev-parse HEAD)
  git pull --ff-only origin "$BRANCH"
  after=$(git rev-parse HEAD)

  if [[ "$before" == "$after" ]]; then
    ok "[$name] ya estaba al día (${after:0:7})"
  else
    ok "[$name] actualizado: ${before:0:7} -> ${after:0:7}"
  fi
}

# ─── Función: instalar dependencias ─────────────────────────────────────
install_deps() {
  local dir="$1" name="$2"
  step "[$name] Instalando dependencias"
  cd "$dir"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    warn "[$name] sin package-lock.json; usando 'npm install'"
    npm install
  fi
  ok "[$name] dependencias listas"
}

# ════════════════════════════════════════════════════════════════════════
# FASE 1 — Preparación (SIN impacto en producción)
# ════════════════════════════════════════════════════════════════════════
update_repo "$API_DIR"   "API"
update_repo "$FRONT_DIR" "FRONT"

install_deps "$API_DIR"   "API"
install_deps "$FRONT_DIR" "FRONT"

# El API es TypeScript ("build": "tsc"); se compila a dist/ y PM2 corre
# node dist/index.js. Hay que recompilar ANTES de reiniciar, o el restart
# levantaría el código viejo. Esto no afecta al proceso vivo (sigue usando
# el código en memoria hasta el pm2 restart de la Fase 2).
step "[API] Compilando (tsc -> dist/)"
cd "$API_DIR"
npm run build
[[ -f "$API_DIR/dist/index.js" ]] \
  || die "[API] El build no generó dist/index.js. Revisa el build antes de reiniciar."
ok "[API] Build OK ($API_DIR/dist/index.js)"

step "[FRONT] Compilando build de producción (tsc -b && vite build)"
cd "$FRONT_DIR"
npm run build
BUILD_PATH="$FRONT_DIR/$BUILD_SUBDIR"
[[ -f "$BUILD_PATH/index.html" ]] \
  || die "[FRONT] El build no generó $BUILD_PATH/index.html. Revisa el build antes de publicar."
ok "[FRONT] Build OK ($BUILD_PATH)"

# ════════════════════════════════════════════════════════════════════════
# FASE 2 — Publicación (CON impacto en producción)
# ════════════════════════════════════════════════════════════════════════

# 2a. Backup del web root actual
step "Respaldando el web root actual"
BACKUP_PATH="$BACKUP_DIR/webroot-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_PATH"
rsync -a "$WEB_ROOT/" "$BACKUP_PATH/"
ok "Backup en $BACKUP_PATH"

# 2b. Publicar el nuevo build, con rollback automático si algo falla
step "Publicando nuevo build en $WEB_ROOT"
if rsync -a --delete "$BUILD_PATH/" "$WEB_ROOT/"; then
  ok "Frontend publicado"
else
  warn "Falló la publicación; restaurando build anterior..."
  if rsync -a --delete "$BACKUP_PATH/" "$WEB_ROOT/"; then
    warn "Web root restaurado desde el backup"
  else
    die "ROLLBACK FALLÓ. Restaura manualmente desde: $BACKUP_PATH"
  fi
  die "Deploy abortado por fallo al publicar el frontend"
fi

# 2c. Reiniciar SOLO el API (nunca 'all', nunca otros procesos)
#
# Se arranca desde ecosystem.config.js, que fija cwd y script dentro de
# $API_DIR. Si PM2 venía apuntando a otro árbol, se recrea el proceso: un
# 'pm2 restart' por nombre conserva la ruta antigua y el deploy no tendría
# ningún efecto (fallo real ocurrido el 2026-08-10).
step "Publicando proceso PM2: $PM2_APP"
cd "$API_DIR"
CURRENT_EXEC="$(pm2_exec_path)"
if [[ -n "$CURRENT_EXEC" && "$CURRENT_EXEC" != "$EXPECTED_EXEC" ]]; then
  warn "Recreando '$PM2_APP' (apuntaba a $CURRENT_EXEC)"
  pm2 delete "$PM2_APP" || true
  pm2 start "$ECOSYSTEM" --only "$PM2_APP" --update-env
elif [[ -z "$CURRENT_EXEC" ]]; then
  pm2 start "$ECOSYSTEM" --only "$PM2_APP" --update-env
else
  pm2 startOrReload "$ECOSYSTEM" --only "$PM2_APP" --update-env
fi
pm2 save >/dev/null 2>&1 || warn "No se pudo ejecutar 'pm2 save' (revisa el arranque tras reiniciar el SO)"
sleep 2

# Verificación 1: el proceso corre el árbol que acabamos de compilar
FINAL_EXEC="$(pm2_exec_path)"
[[ "$FINAL_EXEC" == "$EXPECTED_EXEC" ]] \
  || die "PM2 sigue ejecutando '$FINAL_EXEC' en vez de '$EXPECTED_EXEC'. El deploy NO tuvo efecto."
ok "PM2 ejecuta $FINAL_EXEC"

# Verificación 2: está online
if is_online; then
  ok "$PM2_APP está online"
else
  warn "$PM2_APP NO quedó 'online'. Últimas líneas de log:"
  pm2 logs "$PM2_APP" --lines 20 --nostream || true
  die "El API no arrancó bien. Revisa los logs. (Los demás servicios NO fueron tocados.)"
fi

# Verificación 3: responde en el puerto que espera nginx (proxy_pass)
step "Smoke test en http://127.0.0.1:$API_PORT/api/"
SMOKE_OK=0
for _ in 1 2 3 4 5; do
  if curl -fsS --max-time 5 "http://127.0.0.1:$API_PORT/api/" >/dev/null 2>&1; then
    SMOKE_OK=1; break
  fi
  sleep 2
done
if (( SMOKE_OK )); then
  ok "El API responde en el puerto $API_PORT"
else
  warn "El API NO responde en 127.0.0.1:$API_PORT. Últimas líneas de log:"
  pm2 logs "$PM2_APP" --lines 20 --nostream || true
  die "nginx hace proxy_pass a ese puerto: el sitio quedaría sin API."
fi

# ════════════════════════════════════════════════════════════════════════
# FASE 3 — Limpieza de backups antiguos
# ════════════════════════════════════════════════════════════════════════
step "Limpiando backups antiguos (se conservan $KEEP_BACKUPS)"
mapfile -t backups < <(ls -1dt "$BACKUP_DIR"/webroot-* 2>/dev/null || true)
if (( ${#backups[@]} > KEEP_BACKUPS )); then
  for old in "${backups[@]:KEEP_BACKUPS}"; do
    rm -rf "$old" && echo "  borrado: $old"
  done
fi
ok "Backups OK"

# ─── Resumen ─────────────────────────────────────────────────────────────
ELAPSED=$(( $(date +%s) - START_TS ))
echo -e "\n${C_GREEN}=== Deploy completado en ${ELAPSED}s ===${C_RESET}"
echo "Frontend: $WEB_ROOT   (backup: $BACKUP_PATH)"
echo "API:      PM2 '$PM2_APP' reiniciado"
echo "Log:      $LOG_FILE"