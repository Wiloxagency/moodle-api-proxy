#!/usr/bin/env bash
#
# dashboard_actualizar_todo.sh — tarea diaria (cron) que regenera los reportes.
# ============================================================================
# Equivale a pulsar "Actualizar Todo" en el Dashboard: recorre las inscripciones
# abiertas, regenera el reporte numérico de cada una (grades-numeric), cierra las
# que ya pasaron su fecha de término, refresca el caché del dashboard y envía el
# reporte a VMICA.
#
# Vive dentro del repo del API (moodle-api-proxy/scripts/) para que llegue al
# servidor con el mismo 'git pull' que el código.
#
# Cron (ajusta la ruta si el proyecto está en otro sitio):
#   0 6 * * * /usr/bin/env bash /var/www/moodle-reports/moodle-api-proxy/scripts/dashboard_actualizar_todo.sh >> /var/log/dashboard_actualizar_todo.log 2>&1
#
# API_BASE debe apuntar al puerto del proceso PM2 'reportes-api' (el mismo del
# proxy_pass de nginx). Se puede sobreescribir por entorno.
# ----------------------------------------------------------------------------
set -uo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3600/api}"
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

had_error=0

# 1) Obtener las inscripciones a refrescar
#
# Criterio: NO está cerrada  O  su fecha de término sigue vigente.
#
# Antes bastaba con `status != cerrada`. El problema es que cerrar es
# irreversible (nada reabre una inscripción) y la fecha de término se edita a
# mano: al extender un curso ya cerrado, sus notas dejaban de actualizarse para
# siempre. El 2026-08-10 eso afectaba a 511 de 700 participantes de cursos
# vigentes (485 sólo en Datco).
#
# Esto sólo cambia QUÉ se refresca. No escribe ningún status, así que la regla
# de cierre del paso 2 y el envío a VMICA del paso 4 (que filtra por
# status_vimica, no por status) se comportan exactamente igual que antes.
HOY="$(date +%F)"
if ! curl -fsS "$API_BASE/inscripciones" \
  | jq -r --arg hoy "$HOY" '
      .data[]
      | select(
          ((.status // "" | tostring | ascii_downcase) != "cerrada")
          or ((.termino // "" | tostring | .[0:10]) == "")
          or ((.termino // "" | tostring | .[0:10]) >= $hoy)
        )
      | @base64
    ' > "$TMP_FILE"; then
  echo "[ActualizarTodo] ERROR: no se pudo obtener listado de inscripciones"
  exit 1
fi

total=$(wc -l < "$TMP_FILE" | tr -d ' ')
current=0
fails=0

run_ts=$(date '+%Y-%m-%d %H:%M:%S %Z')
echo "[$run_ts] [ActualizarTodo] Inicio - total abiertas: $total"

# 2) Procesar inscripciones abiertas (mismo flujo del botón Actualizar Todo)
while IFS= read -r row; do
  [ -z "$row" ] && continue
  current=$((current + 1))

  obj=$(echo "$row" | base64 -d)
  id=$(echo "$obj" | jq -r '._id // empty')
  num=$(echo "$obj" | jq -r '.numeroInscripcion | tostring')
  termino=$(echo "$obj" | jq -r '.termino // empty')

  echo "[ActualizarTodo] Procesando $current/$total inscripción $num"

  # Generar/actualizar reporte numérico
  if ! curl -fsS "$API_BASE/participantes/$num/grades-numeric" >/dev/null; then
    echo "[ActualizarTodo] ERROR grades-numeric en inscripción $num"
    fails=$((fails + 1))
    had_error=1
    continue
  fi

  # Cerrar inscripción si corresponde (termino + 1 día)
  if [ -n "$id" ] && [ -n "$termino" ]; then
    termino_date="${termino:0:10}"
    cutoff=$(date -d "$termino_date +1 day" +%s 2>/dev/null || true)
    now=$(date +%s)
    if [ -n "$cutoff" ] && [ "$now" -ge "$cutoff" ]; then
      curl -fsS -X PUT "$API_BASE/inscripciones/$id" \
        -H "Content-Type: application/json" \
        -d '{"status":"cerrada"}' >/dev/null || true
    fi
  fi
done < "$TMP_FILE"

# 3) Refrescar cache de dashboard
if ! curl -fsS "$API_BASE/dashboard/cache?refresh=true" >/dev/null; then
  echo "[ActualizarTodo] ERROR al refrescar cache de dashboard"
  had_error=1
fi

# 4) Ejecutar flujo VMICA equivalente a presionar "Enviar"
#    (genera JSON normalizado + envía + guarda en colección vimica + marca status_vimica cerrada)
vimica_response=""
if ! vimica_response=$(curl -fsS -X POST "$API_BASE/reportes/vimica/enviar" -H "Content-Type: application/json"); then
  echo "[ActualizarTodo] ERROR en envío VMICA"
  had_error=1
else
  vimica_success=$(echo "$vimica_response" | jq -r '.success // "true"' 2>/dev/null || echo "false")
  if [ "$vimica_success" != "true" ]; then
    echo "[ActualizarTodo] ERROR: respuesta VMICA con success=false"
    had_error=1
  else
    echo "[ActualizarTodo] VMICA enviado correctamente"
  fi
fi

end_ts=$(date '+%Y-%m-%d %H:%M:%S %Z')
echo "[$end_ts] [ActualizarTodo] Finalizado - total=$total errores=$fails had_error=$had_error"
exit "$had_error"
