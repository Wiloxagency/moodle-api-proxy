// Mongo en memoria mínimo para probar los controladores sin servidor.
const { ObjectId } = require('mongodb');
const eq = (a, b) => {
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  return a === b;
};
function matchCond(val, cond) {
  if (cond instanceof RegExp) return typeof val === 'string' && cond.test(val);
  if (cond && typeof cond === 'object' && !(cond instanceof ObjectId) && Object.keys(cond).some(k => k.startsWith('$'))) {
    return Object.entries(cond).every(([op, v]) => {
      switch (op) {
        case '$exists': return v ? val !== undefined : val === undefined;
        case '$ne': return !(Array.isArray(val) ? val.some(x => eq(x, v)) : eq(val, v) || (v === null && val === undefined));
        case '$in': return v.some(x => eq(val, x) || (x === null && val === undefined));
        case '$regex': return new RegExp(v).test(String(val ?? ''));
        default: throw new Error('op no soportado ' + op);
      }
    });
  }
  if (cond === null) return val === null || val === undefined;
  return eq(val, cond);
}
function match(doc, filter = {}) {
  return Object.entries(filter).every(([k, c]) => {
    if (k === '$or') return c.some(f => match(doc, f));
    if (k === '$and') return c.every(f => match(doc, f));
    return matchCond(doc[k], c);
  });
}
class Cursor {
  constructor(items) { this.items = items; }
  sort(spec) { const [[k, d]] = Object.entries(spec); this.items.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * d); return this; }
  limit(n) { this.items = this.items.slice(0, n); return this; }
  async toArray() { return this.items.map(x => ({ ...x })); }
}
class Collection {
  constructor() { this.docs = []; }
  find(f) { return new Cursor(this.docs.filter(d => match(d, f))); }
  async findOne(f) { const d = this.docs.find(d => match(d, f)); return d ? { ...d } : null; }
  async insertOne(doc) { const _id = doc._id || new ObjectId(); this.docs.push({ ...doc, _id }); return { insertedId: _id }; }
  async countDocuments(f) { return this.docs.filter(d => match(d, f)).length; }
  async deleteOne(f) { const i = this.docs.findIndex(d => match(d, f)); if (i >= 0) this.docs.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; }
  async updateOne(f, u, opts = {}) {
    let d = this.docs.find(d => match(d, f));
    let upserted = false;
    if (!d && opts.upsert) {
      d = { _id: new ObjectId() };
      for (const [k, v] of Object.entries(f)) if (!k.startsWith('$') && (v === null || typeof v !== 'object' || v instanceof ObjectId)) d[k] = v;
      Object.assign(d, u.$setOnInsert || {});
      this.docs.push(d); upserted = true;
    }
    if (d) Object.assign(d, u.$set || {});
    return { matchedCount: d ? 1 : 0, modifiedCount: d && !upserted ? 1 : 0, upsertedCount: upserted ? 1 : 0 };
  }
  async updateMany(f, u) { const ds = this.docs.filter(d => match(d, f)); ds.forEach(d => Object.assign(d, u.$set || {})); return { modifiedCount: ds.length }; }
  async bulkWrite(ops) {
    let up = 0, mod = 0;
    for (const op of ops) { const r = await this.updateOne(op.updateOne.filter, op.updateOne.update, { upsert: op.updateOne.upsert }); up += r.upsertedCount; mod += r.modifiedCount; }
    return { upsertedCount: up, modifiedCount: mod };
  }
  async createIndex() {}
}
const cols = {};
const col = name => (cols[name] ||= new Collection());
module.exports = {
  cols,
  getMongoClient: async () => ({}),
  getDb: async () => ({ collection: col }),
  getInscripcionesCollection: async () => col('inscripciones'),
  getParticipantesCollection: async () => col('participantes'),
  getSenceCollection: async () => col('sence'),
  getEmpresasCollection: async () => col('empresas'),
  getEjecutivosCollection: async () => col('ejecutivos'),
  getModalidadesCollection: async () => col('modalidades'),
  getUsersCollection: async () => col('users'),
  getVimicaCollection: async () => col('vimica'),
  getCountersCollection: async () => col('counters'),
  getGradesReportsCollection: async () => col('grades_reports'),
  getDashboardCacheCollection: async () => col('dashboard_cache'),
  closeMongo: async () => {},
};
