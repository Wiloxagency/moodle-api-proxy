import { MongoClient, Db, Collection } from 'mongodb';
import { config } from '../config/environment';
import { Inscripcion } from '../types/inscripcion';

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

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
