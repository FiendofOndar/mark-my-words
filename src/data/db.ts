import type { Persistence, SqlDriver } from './driver';
import { createSqlJsDriver } from './sqlJsDriver';
import { migrate } from './migrations';
import { AuthorRepo } from './repositories/authorRepo';
import { PredictionRepo } from './repositories/predictionRepo';
import { SettingsRepo } from './repositories/settingsRepo';

export interface Db {
  driver: SqlDriver;
  authors: AuthorRepo;
  predictions: PredictionRepo;
  settings: SettingsRepo;
  schemaVersion: number;
}

export interface OpenOptions {
  locateFile: (file: string) => string;
  persistence: Persistence;
  persistDebounceMs?: number;
}

export async function openDatabase(opts: OpenOptions): Promise<Db> {
  const driver = await createSqlJsDriver(opts);
  const schemaVersion = migrate(driver);
  await driver.persist();

  return {
    driver,
    authors: new AuthorRepo(driver),
    predictions: new PredictionRepo(driver),
    settings: new SettingsRepo(driver),
    schemaVersion,
  };
}
