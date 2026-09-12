import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { openDatabase, type Db } from './db';
import { MemoryPersistence } from './driver';
import { MIGRATIONS, migrate } from './migrations';
import { createSqlJsDriver } from './sqlJsDriver';
import { seedDemoData } from './seed';
import { CriteriaFrozenError } from './repositories/predictionRepo';
import { resolve } from '../domain/prediction';
import { tallyRecord } from '../domain/scoring';
import { isDueForCheck } from '../domain/cadence';

const require = createRequire(import.meta.url);
const wasmDir = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'));

async function freshDb(): Promise<Db> {
  return openDatabase({
    locateFile: (file) => path.join(wasmDir, file),
    persistence: new MemoryPersistence(),
    persistDebounceMs: 0,
  });
}

let db: Db;
beforeEach(async () => {
  db = await freshDb();
});

describe('migrations', () => {
  it('lands on the latest schema version', () => {
    const latest = MIGRATIONS[MIGRATIONS.length - 1]!.version;
    expect(db.schemaVersion).toBe(latest);
  });

  it('creates every table the app needs', () => {
    const names = db.driver
      .select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((r) => String(r.name));
    for (const table of [
      'authors',
      'predictions',
      'criteria_elements',
      'checks',
      'evidence',
      'amendments',
      'tags',
      'prediction_tags',
      'quota_log',
      'settings',
    ]) {
      expect(names).toContain(table);
    }
  });

  it('upgrades a database that stopped at an earlier version', async () => {
    // Build a v1 database by hand, then let migrate() carry it forward.
    const driver = await createSqlJsDriver({
      locateFile: (file) => path.join(wasmDir, file),
      persistence: new MemoryPersistence(),
      persistDebounceMs: 0,
    });
    const first = MIGRATIONS[0]!;
    driver.transaction(() => {
      for (const statement of first.sql
        .replace(/^\s*--.*$/gm, '')
        .split(';')
        .map((x) => x.trim())
        .filter(Boolean)) {
        driver.run(statement);
      }
    });
    driver.run(`PRAGMA user_version = ${first.version}`);

    const before = driver.select<{ name: string }>("PRAGMA table_info('predictions')");
    expect(before.map((c) => String(c.name))).not.toContain('intake_notes');

    const version = migrate(driver);

    expect(version).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.version);
    const after = driver.select<{ name: string }>("PRAGMA table_info('predictions')");
    expect(after.map((c) => String(c.name))).toContain('intake_notes');
  });

  it('is idempotent', async () => {
    const persistence = new MemoryPersistence();
    const locateFile = (file: string) => path.join(wasmDir, file);
    const first = await openDatabase({ locateFile, persistence, persistDebounceMs: 0 });
    await first.driver.persist();
    const second = await openDatabase({ locateFile, persistence, persistDebounceMs: 0 });
    expect(second.schemaVersion).toBe(first.schemaVersion);
  });
});

describe('constraints', () => {
  it('refuses a negative claim with no disconfirming trigger', () => {
    const author = db.authors.create({ displayName: 'Test' });
    expect(() =>
      db.predictions.create({
        authorId: author.id,
        rawStatement: 'The bubble will not crash.',
        polarity: 'negative',
        statementDate: '2026-09-01T00:00:00.000Z',
        deadlineType: 'fixed_date',
        resolutionDate: '2027-03-01T00:00:00.000Z',
        verificationMode: 'searchable',
        category: 'Economics',
        criteria: ['No 30% drawdown'],
      }),
    ).toThrow();
  });

  it('refuses an event prediction with no stale-out date', () => {
    const author = db.authors.create({ displayName: 'Test' });
    expect(() =>
      db.predictions.create({
        authorId: author.id,
        rawStatement: 'Thor loses an arm.',
        statementDate: '2026-09-01T00:00:00.000Z',
        deadlineType: 'event',
        triggerEvent: 'Avengers: Doomsday releases',
        verificationMode: 'searchable',
        category: 'Entertainment',
        criteria: ['Thor loses an arm'],
      }),
    ).toThrow();
  });
});

describe('prediction repository', () => {
  function samplePrediction() {
    const author = db.authors.findOrCreate({ displayName: 'Popops' });
    return db.predictions.create({
      authorId: author.id,
      rawStatement: 'The Cardinals will win the World Series this year.',
      statementDate: '2026-04-01T00:00:00.000Z',
      deadlineType: 'fixed_date',
      resolutionDate: '2026-11-05T23:59:59.999Z',
      verificationMode: 'searchable',
      category: 'Sports',
      stakes: '$20',
      criteria: ['The St. Louis Cardinals win the 2026 World Series'],
    });
  }

  it('round-trips every field', () => {
    const created = samplePrediction();
    const loaded = db.predictions.getById(created.id);
    expect(loaded).toEqual(created);
  });

  it('stores criteria in order', () => {
    const author = db.authors.create({ displayName: 'X' });
    const p = db.predictions.create({
      authorId: author.id,
      rawStatement: 'Three things happen.',
      statementDate: '2026-09-01T00:00:00.000Z',
      deadlineType: 'fixed_date',
      resolutionDate: '2027-01-01T00:00:00.000Z',
      verificationMode: 'searchable',
      category: 'Other',
      criteria: ['first', '  ', 'second', 'third'],
    });
    expect(db.predictions.criteriaFor(p.id).map((c) => c.text)).toEqual(['first', 'second', 'third']);
  });

  it('reuses an author rather than duplicating one', () => {
    samplePrediction();
    samplePrediction();
    expect(db.authors.list().filter((a) => a.displayName === 'Popops')).toHaveLength(1);
  });

  it('applies a domain patch', () => {
    const created = samplePrediction();
    db.predictions.update(created.id, resolve(created, 'hit', 'user', new Date('2026-11-02T00:00:00.000Z')));
    const loaded = db.predictions.getById(created.id)!;
    expect(loaded.status).toBe('hit');
    expect(loaded.resolvedBy).toBe('user');
    expect(loaded.trend).toBeNull();
  });

  it('records an amendment with its reason and old value', () => {
    const created = samplePrediction();
    db.predictions.amend(created.id, 'normalizedClaim', 'The Cardinals win the 2026 World Series.', 'Ambiguous team name');
    const amendments = db.predictions.amendmentsFor(created.id);
    expect(amendments).toHaveLength(1);
    expect(amendments[0]!.oldValue).toBe(created.normalizedClaim);
    expect(amendments[0]!.reason).toBe('Ambiguous team name');
    expect(db.predictions.getById(created.id)!.normalizedClaim).toBe(
      'The Cardinals win the 2026 World Series.',
    );
  });

  it('refuses an amendment with no reason', () => {
    const created = samplePrediction();
    expect(() => db.predictions.amend(created.id, 'normalizedClaim', 'x', '   ')).toThrow();
  });

  it('lets criteria be rewritten before the freeze', () => {
    const created = samplePrediction();
    db.predictions.replaceCriteria(created.id, ['Something sharper', 'And a second element']);
    expect(db.predictions.criteriaFor(created.id).map((c) => c.text)).toEqual([
      'Something sharper',
      'And a second element',
    ]);
  });

  it('seals criteria once the first check has run', () => {
    const created = samplePrediction();
    db.predictions.freeze(created.id);

    expect(db.predictions.getById(created.id)!.criteriaFrozenAt).toBeTruthy();
    expect(() => db.predictions.replaceCriteria(created.id, ['moved goalposts'])).toThrow(
      CriteriaFrozenError,
    );
    // The amendment path stays open, because editing is allowed and hiding is not.
    expect(() =>
      db.predictions.amend(created.id, 'normalizedClaim', 'Sharper claim', 'Was too vague'),
    ).not.toThrow();
  });

  it('does not move the freeze stamp on a second check', () => {
    const created = samplePrediction();
    db.predictions.freeze(created.id);
    const first = db.predictions.getById(created.id)!.criteriaFrozenAt;
    db.predictions.freeze(created.id);
    expect(db.predictions.getById(created.id)!.criteriaFrozenAt).toBe(first);
  });

  it('seals criteria on resolution even when no check ever ran', () => {
    const created = samplePrediction();
    db.predictions.update(created.id, resolve(created, 'hit', 'user', new Date()));
    expect(() => db.predictions.replaceCriteria(created.id, ['too late'])).toThrow(
      CriteriaFrozenError,
    );
  });

  it('hides soft-deleted predictions from the list', () => {
    const created = samplePrediction();
    db.predictions.softDelete(created.id);
    expect(db.predictions.list()).toHaveLength(0);
    expect(db.predictions.getById(created.id)).not.toBeNull();
  });

  it('filters by status and author', () => {
    const a = samplePrediction();
    db.predictions.update(a.id, resolve(a, 'hit', 'user', new Date()));
    samplePrediction();
    expect(db.predictions.list({ status: ['hit'] })).toHaveLength(1);
    expect(db.predictions.list({ activeOnly: true })).toHaveLength(1);
    expect(db.predictions.list({ authorId: a.authorId })).toHaveLength(2);
  });
});

describe('checks written in the same millisecond', () => {
  function withCheck(predictionId: string, summary: string, outcome: 'queued' | 'no_change') {
    db.checks.create({
      predictionId,
      trigger: 'pull',
      provider: 'test',
      model: null,
      proposedVerdict: outcome === 'queued' ? 'hit' : 'no_change',
      proposedTrend: null,
      rubricScore: null,
      rubricBreakdown: null,
      modelConfidence: null,
      summary,
      outcome,
    });
  }

  function sameMillisecond() {
    db.driver.run("UPDATE checks SET ran_at = '2026-09-12T12:00:00.000Z'");
  }

  it('orders the log by what was written last, not by an ambiguous timestamp', () => {
    const author = db.authors.create({ displayName: 'X' });
    const p = db.predictions.create({
      authorId: author.id,
      rawStatement: 'A thing.',
      statementDate: '2026-01-01T00:00:00.000Z',
      deadlineType: 'fixed_date',
      resolutionDate: '2027-01-01T00:00:00.000Z',
      verificationMode: 'searchable',
      category: 'Other',
      criteria: ['A thing happens'],
    });

    withCheck(p.id, 'first', 'queued');
    withCheck(p.id, 'second', 'no_change');
    sameMillisecond();

    expect(db.checks.listFor(p.id).map((c) => c.summary)).toEqual(['second', 'first']);
  });

  it('does not leave a superseded proposal showing as waiting on the user', () => {
    const author = db.authors.create({ displayName: 'X' });
    const p = db.predictions.create({
      authorId: author.id,
      rawStatement: 'A thing.',
      statementDate: '2026-01-01T00:00:00.000Z',
      deadlineType: 'fixed_date',
      resolutionDate: '2027-01-01T00:00:00.000Z',
      verificationMode: 'searchable',
      category: 'Other',
      criteria: ['A thing happens'],
    });

    withCheck(p.id, 'proposed a verdict', 'queued');
    withCheck(p.id, 'later found nothing', 'no_change');
    sameMillisecond();

    expect(db.checks.queuedVerdicts().has(p.id)).toBe(false);
  });

  it('still surfaces a proposal that is genuinely the latest', () => {
    const author = db.authors.create({ displayName: 'X' });
    const p = db.predictions.create({
      authorId: author.id,
      rawStatement: 'A thing.',
      statementDate: '2026-01-01T00:00:00.000Z',
      deadlineType: 'fixed_date',
      resolutionDate: '2027-01-01T00:00:00.000Z',
      verificationMode: 'searchable',
      category: 'Other',
      criteria: ['A thing happens'],
    });

    withCheck(p.id, 'found nothing', 'no_change');
    withCheck(p.id, 'proposed a verdict', 'queued');
    sameMillisecond();

    expect(db.checks.queuedVerdicts().get(p.id)?.summary).toBe('proposed a verdict');
  });
});

describe('persistence', () => {
  it('survives a reopen', async () => {
    const persistence = new MemoryPersistence();
    const locateFile = (file: string) => path.join(wasmDir, file);

    const first = await openDatabase({ locateFile, persistence, persistDebounceMs: 0 });
    const author = first.authors.create({ displayName: 'Popops' });
    first.predictions.create({
      authorId: author.id,
      rawStatement: 'It will rain.',
      statementDate: '2026-09-01T00:00:00.000Z',
      deadlineType: 'fixed_date',
      resolutionDate: '2026-10-01T00:00:00.000Z',
      verificationMode: 'searchable',
      category: 'Weather/Climate',
      criteria: ['Rain'],
    });
    await first.driver.persist();

    const second = await openDatabase({ locateFile, persistence, persistDebounceMs: 0 });
    expect(second.predictions.list()).toHaveLength(1);
    expect(second.authors.list()[0]!.displayName).toBe('Popops');
  });
});

describe('demo seed', () => {
  it('seeds once and covers open, miss with a late hit, and hit', () => {
    seedDemoData(db);
    seedDemoData(db);

    const all = db.predictions.list();
    expect(all.length).toBe(8);
    expect(all.filter((p) => p.status === 'open').length).toBe(6);
    expect(all.filter((p) => p.lateHitAt).length).toBe(1);
    expect(all.filter((p) => p.status === 'hit').length).toBe(1);
    expect(all.filter((p) => p.verificationMode === 'manual').length).toBe(1);
    expect(all.filter((p) => p.deadlineType === 'window').length).toBe(1);
    expect(all.filter((p) => p.deadlineType === 'event').length).toBe(1);
  });

  it('produces a usable author record', () => {
    seedDemoData(db);
    const me = db.authors.findByName('Me')!;
    const record = tallyRecord(db.predictions.list({ authorId: me.id }));
    expect(record.hit).toBe(1);
    expect(record.open).toBe(2);
  });

  it('seeds a weather claim that is already past its deadline, ready to check', () => {
    seedDemoData(db);
    const weather = db.predictions
      .list()
      .find((p) => p.rawStatement.includes('Anacortes'))!;

    expect(weather).toBeDefined();
    expect(weather.status).toBe('open');
    expect(weather.verificationMode).toBe('searchable');
    // Overdue on purpose: a check should run on the very first pull rather
    // than waiting for a cadence slot.
    expect(new Date(weather.resolutionDate!).getTime()).toBeLessThan(Date.now());
    expect(isDueForCheck(weather).due).toBe(true);
    expect(weather.searchQueries.length).toBeGreaterThan(0);
  });
});
