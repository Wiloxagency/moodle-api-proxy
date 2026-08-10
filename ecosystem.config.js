/**
 * Definición del proceso PM2 del API de reportes.
 * ============================================================================
 *
 * Este archivo existe para que la ruta que ejecuta PM2 esté versionada junto al
 * código y no pueda volver a desincronizarse.
 *
 * Antecedente (2026-08-10): PM2 corría `/var/www/reportes-api/dist/index.js`
 * mientras `deploy.sh` hacía pull y build en
 * `/var/www/moodle-reports/moodle-api-proxy`. El `pm2 restart` reportaba
 * "online" pero levantaba siempre el código antiguo, así que los deploys del
 * API llevaban meses sin efecto real.
 *
 * `cwd: __dirname` ata el proceso a ESTA copia del repositorio, de modo que el
 * árbol que se compila y el que se ejecuta son necesariamente el mismo.
 *
 * Uso en el servidor:
 *   pm2 start ecosystem.config.js          # primera vez
 *   pm2 startOrReload ecosystem.config.js  # lo que hace deploy.sh
 *   pm2 save                               # persistir para el arranque del SO
 *
 * Los secretos (MOODLE_WS_TOKEN, MONGODB_URI, ...) NO van aquí: se leen del
 * archivo .env que vive en este mismo directorio. Ojo: dotenv no pisa las
 * variables ya presentes en el entorno, así que PORT y NODE_ENV definidos aquí
 * tienen prioridad sobre el .env. Es intencional: el puerto 3600 es el que
 * espera el proxy_pass de nginx y el cron dashboard_actualizar_todo.sh.
 */
module.exports = {
  apps: [
    {
      name: 'reportes-api',
      cwd: __dirname,
      script: 'dist/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      time: true,
      env: {
        NODE_ENV: 'production',
        PORT: '3600',
      },
    },
  ],
};
