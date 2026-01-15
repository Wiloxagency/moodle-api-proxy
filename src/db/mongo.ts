import { MongoClient, Db, Collection } from 'mongodb';
import { config } from '../config/environment';
import { Inscripcion } from '../types/inscripcion';
import { Sence } from '../types/sence';
import { Empresa } from '../types/empresa';
import { Ejecutivo } from '../types/ejecutivo';
import { Modalidad } from '../types/modalidad';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getMongoClient(): Promise<MongoClient> {
  if (client) return client;
  if (!config.mongo.uri) throw new Error('MONGODB_URI is not set');
  client = new MongoClient(config.mongo.uri);
  await client.connect();
  return client;
}

export async function getDb(): Promise<Db> {
  if (db) return db;
  const c = await getMongoClient();
  db = c.db(config.mongo.dbName);
  return db;
}

export async function getInscripcionesCollection(): Promise<Collection<Inscripcion>> {
  const database = await getDb();
  return database.collection<Inscripcion>(config.mongo.inscripcionesCollection);
}

// Participants collection
export async function getParticipantesCollection(): Promise<Collection<any>> {
  const database = await getDb();
  return database.collection<any>(config.mongo.participantesCollection);
}

// Sence configuration collection
export async function getSenceCollection(): Promise<Collection<Sence>> {
  const database = await getDb();
  return database.collection<Sence>(config.mongo.senceCollection);
}

// Empresas configuration collection
export async function getEmpresasCollection(): Promise<Collection<Empresa>> {
  const database = await getDb();
  return database.collection<Empresa>(config.mongo.empresasCollection);
}

// Ejecutivos configuration collection
export async function getEjecutivosCollection(): Promise<Collection<Ejecutivo>> {
  const database = await getDb();
  return database.collection<Ejecutivo>(config.mongo.ejecutivosCollection);
}

// Modalidades configuration collection
export async function getModalidadesCollection(): Promise<Collection<Modalidad>> {
  const database = await getDb();
  return database.collection<Modalidad>(config.mongo.modalidadesCollection);
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

// Generic counters collection (for sequences)
export async function getCountersCollection(): Promise<import('mongodb').Collection<{ _id: string; seq: number }>> {
  const database = await getDb();
  // @ts-ignore - property added in config
  const name = (config as any).mongo.countersCollection || 'counters';
  return database.collection(name);
}
