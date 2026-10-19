#!/usr/bin/env bash
#
# add-whitelabel-domain.sh — Publica el reporte en el dominio de un cliente White Label
# ==================================================================================
# Crea en nginx un sitio para el dominio, idéntico al de reportes.edutecno.com:
# mismo docroot (lo actualiza deploy.sh, nada que copiar por cliente) y mismo
# /api/ -> 127.0.0.1:3600. Después pide el certificado con certbot, que añade
# el bloque 443 y la redirección de http a https.
#
# El frontend reconoce el White Label por el dominio, así que además hay que
# configurar la empresa en el Dashboard (Empresas > White Label) con este mismo
# "Dominio del reporte". El orden da igual.
#
# Uso:   sudo bash /var/www/moodle-reports/moodle-api-proxy/scripts/add-whitelabel-domain.sh reportes.cliente.cl
#
# Opciones:
#   --skip-dns-check   no comprobar que el DNS apunte a este servidor
#
# Overrides opcionales por variable de entorno:  WEB_ROOT  API_PORT
#
# Seguro con los demás sitios: sólo crea archivos nuevos (nunca edita uno
# existente), valida con 'nginx -t' antes de recargar y deshace lo creado si
# la validación falla.
# ------------------------------------------------------------------------------

set -euo pipefail

WEB_ROOT="${WEB_ROOT:-/var/www/reportes.edutecno.com}"
API_PORT="${API_PORT:-3600}"
RESERVED=("reportes.edutecno.com" "clicklaboral.cl" "www.clicklaboral.cl")

C_RED='\033[0;31m'; C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_BLUE='\033[0;34m'; C_RESET='\033[0m'
step() { echo -e "\n${C_BLUE}==> $*${C_RESET}"; }
ok()   { echo -e "${C_GREEN}OK  $*${C_RESET}"; }
warn() { echo -e "${C_YELLOW}!   $*${C_RESET}"; }
die()  { echo -e "${C_RED}ERR $*${C_RESET}" >&2; exit 1; }

# ─── Argumentos ─────────────────────────────────────────────────────────
DOMAIN=""
SKIP_DNS=0
for arg in "$@"; do
  case "$arg" in
    --skip-dns-check) SKIP_DNS=1 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    -*) die "Opción desconocida: $arg" ;;
    *) DOMAIN="$arg" ;;
  esac
done

[[ -n "$DOMAIN" ]] || die "Falta el dominio. Uso: sudo bash $0 reportes.cliente.cl"
# Normalizar: minúsculas, sin protocolo, ruta ni puerto
DOMAIN="$(echo "$DOMAIN" | tr '[:upper:]' '[:lower:]' | sed -E 's#^[a-z]+://##; s#[/?#].*$##; s#:[0-9]+$##; s#\.$##')"
[[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || die "Dominio inválido: $DOMAIN"
for r in "${RESERVED[@]}"; do
  [[ "$DOMAIN" != "$r" ]] || die "$DOMAIN es un dominio de la plataforma principal, no de un White Label"
done

[[ $EUID -eq 0 ]] || die "Ejecutar con sudo"

AVAILABLE="/etc/nginx/sites-available/$DOMAIN"
ENABLED="/etc/nginx/sites-enabled/$DOMAIN"

echo -e "${C_BLUE}=== Alta de dominio White Label: $DOMAIN — $(date) ===${C_RESET}"

# ─── Comprobaciones ─────────────────────────────────────────────────────
step "Verificando entorno"
for cmd in nginx certbot curl getent systemctl; do
  command -v "$cmd" >/dev/null 2>&1 || die "Falta el comando: $cmd"
done
[[ -f "$WEB_ROOT/index.html" ]] || die "No existe $WEB_ROOT/index.html (¿se ha hecho deploy?)"
[[ ! -e "$AVAILABLE" && ! -e "$ENABLED" ]] || die "Ya existe una configuración para $DOMAIN en nginx; no se toca"
if grep -RqsE "server_name[^;]*[[:space:]]$DOMAIN[[:space:];]" /etc/nginx/sites-enabled/; then
  die "Otro sitio de nginx ya usa server_name $DOMAIN"
fi
curl -fsS "http://127.0.0.1:$API_PORT/api/" >/dev/null || die "El API no responde en 127.0.0.1:$API_PORT"
ok "Entorno OK"

step "Comprobando DNS"
DNS_IPS="$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u | tr '\n' ' ')"
LOCAL_IPS=" $(hostname -I) "
if [[ $SKIP_DNS -eq 1 ]]; then
  warn "Comprobación de DNS omitida (--skip-dns-check)"
elif [[ -z "$DNS_IPS" ]]; then
  die "$DOMAIN no resuelve todavía. Pide que creen el registro A hacia este servidor ($(hostname -I | awk '{print $1}'))"
else
  match=0
  for ip in $DNS_IPS; do [[ "$LOCAL_IPS" == *" $ip "* ]] && match=1; done
  [[ $match -eq 1 ]] || die "$DOMAIN apunta a $DNS_IPS y este servidor es $(hostname -I). Corrige el DNS (o usa --skip-dns-check si hay un proxy delante)"
  ok "$DOMAIN -> $DNS_IPS"
fi

# ─── Sitio nginx (sólo http; certbot añade https) ───────────────────────
step "Creando sitio nginx $AVAILABLE"
cat > "$AVAILABLE" <<NGINX
# White Label: $DOMAIN — creado por add-whitelabel-domain.sh el $(date +%F)
# Mismo frontend y API que reportes.edutecno.com; el frontend reconoce la
# empresa por el dominio (Empresas > White Label > Dominio del reporte).
server {
    listen 80;
    server_name $DOMAIN;

    root $WEB_ROOT;
    index index.html;

    location / {
        try_files \$uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:$API_PORT/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout    600s;
        proxy_connect_timeout 300s;
        proxy_send_timeout    300s;
    }
}
NGINX
ln -s "$AVAILABLE" "$ENABLED"

if ! nginx -t 2>&1; then
  rm -f "$ENABLED" "$AVAILABLE"
  die "nginx -t falló; se deshizo lo creado y nginx sigue como estaba"
fi
systemctl reload nginx
ok "Sitio http activo"

# ─── Certificado ────────────────────────────────────────────────────────
step "Pidiendo certificado (certbot)"
if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect; then
  ok "Certificado instalado y http -> https"
else
  warn "certbot falló. El sitio queda sólo en http; corrige y repite:"
  warn "  sudo certbot --nginx -d $DOMAIN --redirect"
  exit 1
fi

# ─── Verificación ───────────────────────────────────────────────────────
step "Verificando https://$DOMAIN"
code="$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/")"
[[ "$code" == "200" ]] && ok "Frontend responde (200)" || warn "El frontend respondió $code"
resp="$(curl -s "https://$DOMAIN/api/empresas/whitelabel?host=$DOMAIN" || true)"
echo "    $resp"
if [[ "$resp" == *'"whiteLabel":true'* ]]; then
  ok "El dominio ya está asociado a una empresa White Label"
else
  warn "Ninguna empresa tiene todavía este dominio: configúrala en Empresas > White Label"
fi

echo -e "\n${C_GREEN}=== $DOMAIN listo ===${C_RESET}"
