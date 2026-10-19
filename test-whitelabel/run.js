// Prueba de punta a punta del modo White Label, sin Mongo ni Moodle reales:
// Mongo en memoria (fakeMongo.js) y dos Moodle falsos en 4801/4802.
// Uso: node test-whitelabel/run.js   (debe terminar en "TODO OK")
process.env.MOODLE_BASE_URL = 'http://127.0.0.1:4801';
process.env.MOODLE_WS_TOKEN = 'TOKEN_DEFAULT';
process.env.MONGODB_URI = 'mongodb://fake';
process.env.NODE_ENV = 'test';
require('ts-node').register({ transpileOnly: true, project: __dirname + '/../tsconfig.json' });
const path = require('path');
const fake = require('./fakeMongo');
const mongoPath = require.resolve(path.join(__dirname, '../src/db/mongo.ts'));
require.cache[mongoPath] = { id: mongoPath, filename: mongoPath, loaded: true, exports: fake };
const express = require('express');

// --- Dos Moodle falsos: registran qué token llega a cada uno ---
const calls = [];
const ALL_FUNCS = require('../src/utils/whiteLabel.ts').REQUIRED_WS_FUNCTIONS;
function fakeMoodle(port, name, release, funcs) {
  const app = express();
  app.get('/webservice/rest/server.php', (req, res) => {
    const { wsfunction, wstoken } = req.query;
    calls.push({ moodle: name, wsfunction, wstoken });
    if (wsfunction === 'core_webservice_get_site_info')
      return res.json({ sitename: name, release, functions: funcs.map(n => ({ name: n })) });
    if (wsfunction === 'core_course_get_courses_by_field')
      return res.json({ courses: [{ id: Number(req.query.value), fullname: `Curso de ${name}` }], warnings: [] });
    if (wsfunction === 'core_enrol_get_enrolled_users')
      return res.json([{ id: 7, username: '11111111-1', firstname: 'Ana', lastname: 'Paz', email: 'a@x.cl', lastaccess: 0 }]);
    return res.json({ exception: 'x', errorcode: 'nofn', message: 'no implementado en fake: ' + wsfunction });
  });
  return new Promise(r => app.listen(port, r));
}

const PNG = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
let fails = 0;
const check = (name, cond, extra) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`); if (!cond) fails++; };

(async () => {
  await fakeMoodle(4801, 'DEFAULT', '4.4.2 (Build: 1)', ALL_FUNCS);
  await fakeMoodle(4802, 'CLIENTE', '5.0.1 (Build: 2)', ALL_FUNCS.filter(f => f !== 'mod_quiz_get_user_best_grade'));
  const app = require('../src/app.ts').default;
  await new Promise(r => app.listen(4800, r));
  const B = 'http://127.0.0.1:4800/api';
  const j = async (method, url, body) => {
    const r = await fetch(B + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json, headers: r.headers };
  };

  // Empresas base
  const mutual = (await j('POST', '/empresas', { nombre: 'Mutual', status: 'Activo' })).json.data;
  const otra = (await j('POST', '/empresas', { nombre: 'Normal SA', status: 'Activo' })).json.data;
  check('empresa 1 = Mutual', mutual.code === 1);

  // Validaciones WL
  const wlBase = { nombre: 'Cliente WL', status: 'Activo', whiteLabel: true, wlDominio: 'https://Reportes.Cliente.cl/login', wlMoodleUrl: 'http://127.0.0.1:4802/', wlMoodleToken: 'TOKEN_CLIENTE', wlMoodleVersion: 5, wlLogo: PNG };
  let r = await j('POST', '/empresas', { ...wlBase, wlLogo: undefined });
  check('WL sin logo -> 400', r.status === 400, r.json);
  r = await j('POST', '/empresas', { ...wlBase, wlMoodleVersion: 3 });
  check('WL Moodle 3 -> 400', r.status === 400 && /4 o 5/.test(r.json.error.message), r.json);
  r = await j('POST', '/empresas', { ...wlBase, wlDominio: 'www.clicklaboral.cl' });
  check('WL con dominio principal -> 400', r.status === 400, r.json);
  r = await j('POST', '/empresas', { ...wlBase, wlLogo: 'data:image/svg+xml;base64,PHN2Zz4=' });
  check('WL logo SVG -> 400', r.status === 400, r.json);
  r = await j('PUT', `/empresas/${mutual._id}`, { ...wlBase, nombre: 'Mutual' });
  check('empresa 1 no puede ser WL', r.status === 400 && /VMICA/.test(r.json.error.message), r.json);

  r = await j('POST', '/empresas', wlBase);
  check('crear WL ok', r.status === 201, r.json);
  const wl = r.json.data;
  check('dominio normalizado', wl.wlDominio === 'reportes.cliente.cl', wl.wlDominio);
  check('URL Moodle sin barra final', wl.wlMoodleUrl === 'http://127.0.0.1:4802', wl.wlMoodleUrl);
  check('token no sale por la API', wl.wlMoodleToken === undefined && wl.wlMoodleTokenSet === true, wl);
  check('logo no sale en el listado', wl.wlLogo === undefined && !!wl.wlLogoVersion, wl);
  r = await j('POST', '/empresas', { ...wlBase, nombre: 'Otra WL', wlDominio: 'www.reportes.cliente.cl' });
  check('dominio WL duplicado -> 400', r.status === 400, r.json);

  // Editar sin reenviar token ni logo los conserva
  r = await j('PUT', `/empresas/${wl._id}`, { ...wl, nombre: 'Cliente WL 2' });
  check('editar WL sin token/logo ok', r.status === 200 && r.json.data.wlMoodleTokenSet && r.json.data.wlLogoVersion === wl.wlLogoVersion, r.json);
  check('token sigue guardado en BD', fake.cols.empresas.docs.find(e => e.code === wl.code).wlMoodleToken === 'TOKEN_CLIENTE');

  const list = (await j('GET', '/empresas')).json.data;
  check('listado sin tokens', list.every(e => e.wlMoodleToken === undefined));

  r = await fetch(`${B}/empresas/${wl.code}/logo`);
  check('logo servido como PNG', r.status === 200 && r.headers.get('content-type') === 'image/png');

  // Resolución por dominio
  r = await j('GET', '/empresas/whitelabel?host=reportes.cliente.cl');
  check('resolve WL', r.json.data.whiteLabel === true && r.json.data.empresa === wl.code, r.json);
  r = await j('GET', '/empresas/whitelabel?host=www.reportes.cliente.cl');
  check('resolve WL con www', r.json.data.whiteLabel === true);
  r = await j('GET', '/empresas/whitelabel?host=reportes.edutecno.com');
  check('reportes.edutecno.com no es WL', r.json.data.whiteLabel === false);
  r = await j('GET', '/empresas/whitelabel?host=clicklaboral.cl');
  check('clicklaboral.cl no es WL', r.json.data.whiteLabel === false);

  // Probar conexión
  r = await j('POST', '/empresas/moodle/test', { url: 'http://127.0.0.1:4802', empresaId: wl._id, version: 5 });
  check('test usa token guardado y detecta v5', r.json.data.major === 5 && r.json.data.sitename === 'CLIENTE', r.json);
  check('test reporta función faltante', !r.json.data.ok && r.json.data.missingFunctions.includes('mod_quiz_get_user_best_grade'), r.json);
  check('test usó TOKEN_CLIENTE', calls.at(-1).wstoken === 'TOKEN_CLIENTE');
  r = await j('POST', '/empresas/moodle/test', { url: 'http://127.0.0.1:4802', token: 'X', version: 4 });
  check('test detecta versión distinta', /no coincide/.test(r.json.data.message), r.json);

  // Usuarios
  await j('GET', '/users'); // crea superadmin inicial
  const sa = fake.cols.users.docs.find(u => u.role === 'superAdmin');
  check('superadmin inicial en empresa no WL', sa.empresa === 1, sa);
  r = await j('POST', '/users', { username: 'sa2', password: 'x', role: 'superAdmin', empresa: wl.code });
  check('superAdmin en WL -> 400', r.status === 400, r.json);
  r = await j('POST', '/users', { username: 'adm', password: 'x', role: 'admin', empresa: otra.code });
  check('admin en empresa normal -> 400', r.status === 400, r.json);
  r = await j('POST', '/users', { username: 'adm', password: 'x', role: 'admin', empresa: wl.code });
  check('admin en WL ok', r.status === 201, r.json);
  const adm = r.json.data;
  r = await j('PUT', `/users/${adm._id}`, { role: 'superAdmin' });
  check('promover admin WL a superAdmin -> 400', r.status === 400, r.json);
  await j('POST', '/users', { username: 'normal', password: 'x', role: 'user', empresa: otra.code });
  r = await j('GET', `/users?empresa=${wl.code}`);
  check('listar usuarios por empresa', r.json.data.length === 1 && r.json.data[0].username === 'adm', r.json);

  // Login por dominio
  r = await j('POST', '/users/login', { username: 'adm', password: 'x', host: 'reportes.edutecno.com' });
  check('usuario WL en dominio principal -> 403', r.status === 403 && /reportes\.cliente\.cl/.test(r.json.error.message), r.json);
  r = await j('POST', '/users/login', { username: 'adm', password: 'x' });
  check('usuario WL sin host -> 403', r.status === 403);
  r = await j('POST', '/users/login', { username: 'adm', password: 'x', host: 'reportes.cliente.cl' });
  check('usuario WL en su dominio ok', r.status === 200 && r.json.data.role === 'admin', r.json);
  r = await j('POST', '/users/login', { username: 'normal', password: 'x', host: 'reportes.cliente.cl' });
  check('usuario de otra empresa en dominio WL -> 401', r.status === 401);
  r = await j('POST', '/users/login', { username: 'superadmin', password: '123456', host: 'reportes.cliente.cl' });
  check('superadmin en WL queda fijado a la empresa', r.status === 200 && r.json.data.empresa === wl.code, r.json);
  r = await j('POST', '/users/login', { username: 'normal', password: 'x', host: 'clicklaboral.cl' });
  check('usuario normal en dominio principal ok', r.status === 200);

  // No se puede quitar WL con admins; no se puede activar WL con superadmins
  r = await j('PUT', `/empresas/${wl._id}`, { whiteLabel: false });
  check('quitar WL con Administradores -> 400', r.status === 400, r.json);
  await j('POST', '/users', { username: 'sa3', password: 'x', role: 'superAdmin', empresa: otra.code });
  r = await j('PUT', `/empresas/${otra._id}`, { ...wlBase, nombre: 'Normal SA', wlDominio: 'x.cliente.cl' });
  check('empresa con superadmin no puede ser WL', r.status === 400 && /Superadmin/.test(r.json.error.message), r.json);

  // Moodle por empresa
  calls.length = 0;
  r = await j('GET', `/cursos/field/id/55?empresa=${wl.code}`);
  check('cursos ?empresa=WL usa Moodle del cliente', r.json.data.courses[0].fullname === 'Curso de CLIENTE' && calls[0].wstoken === 'TOKEN_CLIENTE', r.json);
  r = await j('GET', `/cursos/field/id/55`);
  check('cursos sin empresa usa Moodle por defecto', r.json.data.courses[0].fullname === 'Curso de DEFAULT');
  r = await j('GET', `/cursos/field/id/55?empresa=${otra.code}`);
  check('cursos empresa normal usa Moodle por defecto', r.json.data.courses[0].fullname === 'Curso de DEFAULT');

  // Inscripción WL -> import desde Moodle va al Moodle del cliente
  await (await fake.getInscripcionesCollection()).insertOne({ numeroInscripcion: 900, empresa: wl.code, idMoodle: '55', termino: '2030-01-01' });
  await (await fake.getInscripcionesCollection()).insertOne({ numeroInscripcion: 901, empresa: otra.code, idMoodle: '55', termino: '2030-01-01' });
  calls.length = 0;
  r = await j('POST', '/participantes/import/moodle', { numeroInscripcion: 900 });
  check('import Moodle de inscripción WL usa token cliente', calls.length > 0 && calls.every(c => c.wstoken === 'TOKEN_CLIENTE'), { status: r.status, calls });
  calls.length = 0;
  r = await j('POST', '/participantes/import/moodle', { numeroInscripcion: 901 });
  check('import Moodle de inscripción normal usa token por defecto', calls.length > 0 && calls.every(c => c.wstoken === 'TOKEN_DEFAULT'), { status: r.status, calls });

  calls.length = 0;
  r = await j('GET', '/participantes/900/grades-numeric');
  check('grades-numeric WL sólo consulta Moodle cliente', calls.length > 0 && calls.every(c => c.moodle === 'CLIENTE'), { status: r.status, n: calls.length, calls: calls.slice(0, 3) });
  calls.length = 0;
  r = await j('GET', '/participantes/901/grades-numeric');
  check('grades-numeric normal sólo consulta Moodle por defecto', calls.length > 0 && calls.every(c => c.moodle === 'DEFAULT'), { status: r.status, n: calls.length });

  // WL mal configurado nunca cae al Moodle por defecto
  fake.cols.empresas.docs.find(e => e.code === wl.code).wlMoodleToken = '';
  const { invalidateTenantCache } = require('../src/services/moodleTenant.ts');
  invalidateTenantCache();
  calls.length = 0;
  r = await j('GET', '/participantes/900/grades-numeric');
  check('WL sin token -> 409 y sin llamar a ningún Moodle', r.status === 409 && calls.length === 0, { status: r.status, json: r.json, calls });
  fake.cols.empresas.docs.find(e => e.code === wl.code).wlMoodleToken = 'TOKEN_CLIENTE';
  invalidateTenantCache();

  // Catálogos por empresa
  await j('POST', '/modalidades', { nombre: 'Global' });
  await j('POST', '/modalidades', { nombre: 'Del cliente', empresa: wl.code });
  await j('POST', '/modalidades', { nombre: 'Normal con empresa', empresa: otra.code }); // empresa no WL -> global
  r = await j('GET', '/modalidades');
  check('modalidades globales excluyen las del WL', r.json.data.map(m => m.nombre).join('|') === 'Global|Normal con empresa', r.json.data);
  r = await j('GET', `/modalidades?empresa=${wl.code}`);
  check('modalidades del WL', r.json.data.map(m => m.nombre).join('|') === 'Del cliente', r.json.data);
  const mod = r.json.data[0];
  await j('PUT', `/modalidades/${mod._id}`, { nombre: 'Movida', empresa: otra.code });
  r = await j('GET', `/modalidades?empresa=${wl.code}`);
  check('editar no cambia el ámbito', r.json.data[0]?.nombre === 'Movida', r.json.data);
  await j('POST', '/ejecutivos', { nombres: 'Eje', apellidos: 'WL', status: 'Activo', empresa: wl.code });
  r = await j('GET', '/ejecutivos');
  check('ejecutivos globales sin los del WL', r.json.data.length === 0, r.json.data);

  await j('POST', '/sence/import/bulk', { cursos: [{ codigo_sence: 'S1', nombre_sence: 'Global' }] });
  r = await j('POST', '/sence/import/bulk', { cursos: [{ codigo_sence: 'S1', nombre_sence: 'Cliente' }], empresa: wl.code });
  check('sence import WL inserta aparte (mismo código)', r.json.data.inserted === 1 && r.json.data.total === 1, r.json);
  r = await j('POST', '/sence/import/bulk', { cursos: [{ codigo_sence: 'S1', nombre_sence: 'Global v2' }] });
  check('sence import global actualiza sólo el global', r.json.data.inserted === 0 && r.json.data.total === 1, r.json);
  const sg = (await j('GET', '/sence')).json.data, sw = (await j('GET', `/sence?empresa=${wl.code}`)).json.data;
  check('sence separados', sg.length === 1 && sg[0].nombre_sence === 'Global v2' && sw.length === 1 && sw[0].nombre_sence === 'Cliente' && sg[0].empresa === undefined, { sg, sw });

  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
