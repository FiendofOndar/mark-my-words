import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { openDatabase, type Db } from './db';
import { MemoryPersistence } from './driver';
import { MIGRATIONS, migrate } from './migrations';
import { createSqlJsDriver } from './sqlJsDriver';
import { seedDemoData } from './seed';
import { CriteriaFrozenError } from './repositories/predictionRepo';
import { resolve, toLocalDateInput } from '../domain/prediction';
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

  /*
   * The evidence table was rebuilt in v5 to widen a CHECK constraint, and a
   * rebuild is the one migration shape that can silently drop rows.
   */
  it('carries evidence rows through the v5 table rebuild', async () => {
    const driver = await createSqlJsDriver({
      locateFile: (file) => path.join(wasmDir, file),
      persistence: new MemoryPersistence(),
      persistDebounceMs: 0,
    });

    const run = (sql: string) => {
      driver.transaction(() => {
        for (const statement of sql
          .replace(/^\s*--.*$/gm, '')
          .split(';')
          .map((x) => x.trim())
          .filter(Boolean)) {
          driver.run(statement);
        }
      });
    };

    for (const m of MIGRATIONS.filter((m) => m.version <= 4)) {
      run(m.sql);
      driver.run(`PRAGMA user_version = ${m.version}`);
    }

    driver.run(
      `INSERT INTO authors (id, display_name, kind, created_at, updated_at)
       VALUES ('a1', 'Pop-pops', 'person', '2026-01-01', '2026-01-01')`,
    );
    driver.run(
      `INSERT INTO predictions (id, author_id, raw_statement, normalized_claim, polarity,
                                statement_date, deadline_type, verification_mode, status,
                                category, created_at, updated_at)
       VALUES ('p1', 'a1', 'raw', 'claim', 'positive', '2026-01-01', 'fixed_date',
               'searchable', 'open', 'Weather', '2026-01-01', '2026-01-01')`,
    );
    driver.run(
      `INSERT INTO checks (id, prediction_id, ran_at, trigger, provider, summary, outcome,
                           created_at, updated_at)
       VALUES ('c1', 'p1', '2026-01-01', 'pull', 'demo', 's', 'no_change', '2026-01-01', '2026-01-01')`,
    );
    driver.run(
      `INSERT INTO evidence (id, check_id, url, fetch_status, created_at, updated_at)
       VALUES ('e1', 'c1', 'https://weather.gov/x', 'quote_not_found', '2026-01-01', '2026-01-01')`,
    );

    expect(migrate(driver)).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.version);

    const rows = driver.select<{ id: string; url: string; fetch_status: string }>(
      'SELECT id, url, fetch_status FROM evidence',
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.url)).toBe('https://weather.gov/x');
    // A page that loaded but did not carry the quote was still a page that
    // loaded. The quote check is gone; the link check is what remains.
    expect(String(rows[0]!.fetch_status)).toBe('ok');

    driver.run(
      `INSERT INTO evidence (id, check_id, url, fetch_status, created_at, updated_at)
       VALUES ('e3', 'c1', 'https://weather.gov/z', 'not_checked', '2026-01-01', '2026-01-01')`,
    );
    expect(driver.select('SELECT id FROM evidence')).toHaveLength(2);
    expect(() =>
      driver.run(
        `INSERT INTO evidence (id, check_id, url, fetch_status, created_at, updated_at)
         VALUES ('e4', 'c1', 'https://weather.gov/w', 'facts_found', '2026-01-01', '2026-01-01')`,
      ),
    ).toThrow();
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

  it('corrects a frozen criterion through the amendment log', () => {
    // The one that made this necessary: a claim about the 11th came back from
    // the drafting model with criteria about the 12th, froze on the first
    // check, and then could only ever answer "the day is not over".
    const created = samplePrediction();
    db.predictions.freeze(created.id);
    const before = db.predictions.criteriaFor(created.id)[0]!;

    db.predictions.amendCriterion(before.id, 'The Cardinals win on 2026-10-27', 'Wrong date drafted');

    expect(db.predictions.criteriaFor(created.id)[0]!.text).toBe(
      'The Cardinals win on 2026-10-27',
    );
    const amendments = db.predictions.amendmentsFor(created.id);
    expect(amendments).toHaveLength(1);
    expect(amendments[0]!.field).toBe('criterion 1');
    expect(amendments[0]!.oldValue).toBe(before.text);
    expect(amendments[0]!.reason).toBe('Wrong date drafted');
  });

  it('refuses to correct a criterion without a reason, or into nothing', () => {
    const created = samplePrediction();
    const element = db.predictions.criteriaFor(created.id)[0]!;
    expect(() => db.predictions.amendCriterion(element.id, 'Something else', '  ')).toThrow();
    expect(() => db.predictions.amendCriterion(element.id, '   ', 'A reason')).toThrow();
    expect(db.predictions.amendmentsFor(created.id)).toHaveLength(0);
    expect(db.predictions.criteriaFor(created.id)[0]!.text).toBe(element.text);
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

describe('what a check cost', () => {
  function predictionFor(): string {
    const author = db.authors.create({ displayName: 'X' });
    return db.predictions.create({
      authorId: author.id,
      rawStatement: 'A thing.',
      statementDate: '2026-01-01T00:00:00.000Z',
      deadlineType: 'fixed_date',
      resolutionDate: '2027-01-01T00:00:00.000Z',
      verificationMode: 'searchable',
      category: 'Other',
      criteria: ['A thing happens'],
    }).id;
  }

  function write(searchQueries: string[] | null | undefined): string[] | null {
    const check = db.checks.create({
      predictionId: predictionFor(),
      trigger: 'pull',
      provider: 'gemini',
      model: 'g',
      proposedVerdict: 'no_change',
      proposedTrend: null,
      modelConfidence: null,
      summary: 's',
      outcome: 'no_change',
      searchQueries,
    });
    return db.checks.listFor(check.predictionId)[0]!.searchQueries;
  }

  it('keeps the searches a grounded check ran', () => {
    expect(write(['a query', 'another query'])).toEqual(['a query', 'another query']);
  });

  it('totals the month by instant, not by a local date prefix', () => {
    const id = predictionFor();
    const write = (ranAt: string, queries: string[]) => {
      const c = db.checks.create({
        predictionId: id,
        trigger: 'pull',
        provider: 'gemini',
        model: 'g',
        proposedVerdict: 'no_change',
        proposedTrend: null,
        modelConfidence: null,
        summary: 's',
        outcome: 'no_change',
        searchQueries: queries,
      });
      db.driver.run('UPDATE checks SET ran_at = ? WHERE id = ?', [ranAt, c.id]);
    };

    const at = new Date(2026, 8, 15, 12, 0, 0);
    const inside = new Date(2026, 8, 2, 9, 0, 0).toISOString();
    const before = new Date(2026, 7, 20, 9, 0, 0).toISOString();
    write(inside, ['a', 'b', 'c']);
    write(before, ['d', 'e']);

    expect(db.quota.searchesThisMonth(at)).toBe(3);
  });

  it('totals the tokens the provider reported, by instant for the month', () => {
    const id = predictionFor();
    const write = (ranAt: string, tokens: number | null) => {
      const c = db.checks.create({
        predictionId: id,
        trigger: 'pull',
        provider: 'gemini',
        model: 'g',
        proposedVerdict: 'no_change',
        proposedTrend: null,
        modelConfidence: null,
        summary: 's',
        outcome: 'no_change',
        tokensUsed: tokens,
      });
      db.driver.run('UPDATE checks SET ran_at = ? WHERE id = ?', [ranAt, c.id]);
    };
    const at = new Date(2026, 8, 15, 12, 0, 0);
    write(new Date(2026, 8, 2, 9, 0, 0).toISOString(), 1200);
    write(new Date(2026, 7, 20, 9, 0, 0).toISOString(), 800);
    write(new Date(2026, 8, 3, 9, 0, 0).toISOString(), null);

    expect(db.quota.tokensUsed(at)).toEqual({ allTime: 2000, thisMonth: 1200 });
  });

  it('separates not being told from being told none', () => {
    // A provider that does not report searches, and a check written before the
    // column existed, both read as null. Neither is a claim that none ran.
    expect(write(null)).toBeNull();
    expect(write(undefined)).toBeNull();
    expect(write([])).toBeNull();
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
    expect(all.length).toBe(12);
    expect(all.filter((p) => p.status === 'open').length).toBe(10);
    expect(all.filter((p) => p.lateHitAt).length).toBe(1);
    expect(all.filter((p) => p.status === 'hit').length).toBe(1);
    expect(all.filter((p) => p.verificationMode === 'manual').length).toBe(1);
    expect(all.filter((p) => p.deadlineType === 'window').length).toBe(1);
    // The live fixtures: one negative claim, one that can still happen late.
    expect(all.filter((p) => p.polarity === 'negative').length).toBe(1);
    expect(all.filter((p) => p.status === 'open' && p.canHappenLate).length).toBe(1);
  });

  it('produces a usable author record', () => {
    seedDemoData(db);
    const me = db.authors.findByName('Me')!;
    const record = tallyRecord(db.predictions.list({ authorId: me.id }));
    expect(record.hit).toBe(1);
    expect(record.open).toBe(3);
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

  it('seeds a second live fixture that tests what the weather one cannot', () => {
    // Deliberately the opposite case on every axis that matters: a hit rather
    // than a miss, two discrete criteria rather than one numeric threshold, no
    // geography, and static recap pages rather than a forecast that rewrites
    // itself. It is the only fair test of quote matching in the app.
    seedDemoData(db);
    const bowl = db.predictions.list().find((p) => p.normalizedClaim.includes('Super Bowl LIX'))!;

    expect(bowl).toBeDefined();
    expect(bowl.status).toBe('open');
    expect(bowl.verificationMode).toBe('searchable');
    expect(isDueForCheck(bowl).due).toBe(true);
    expect(db.predictions.criteriaFor(bowl.id)).toHaveLength(2);
    // Said before the game, so sources published after it are temporally sane.
    expect(new Date(bowl.statementDate).getTime()).toBeLessThan(
      new Date(bowl.resolutionDate!).getTime(),
    );
  });

  it('writes the same day into the deadline, the claim and the criteria', () => {
    // The seed built its prose with `.slice(0, 10)` on a local end-of-day
    // instant, which is the next day's UTC date everywhere west of Greenwich.
    // The deadline rendered as the 11th while the criteria asked about the
    // 12th, so every check correctly reported that the day was not over yet and
    // the claim could never settle. The suite runs in Pacific so this can fail.
    seedDemoData(db);
    const weather = db.predictions
      .list()
      .find((p) => p.rawStatement.includes('Anacortes'))!;

    const deadline = toLocalDateInput(weather.resolutionDate!);
    expect(deadline).not.toBe(weather.resolutionDate!.slice(0, 10));

    for (const element of db.predictions.criteriaFor(weather.id)) {
      expect(element.text).toContain(deadline);
    }
    expect(weather.normalizedClaim).toContain(deadline);
    for (const query of weather.searchQueries) {
      expect(query).toContain(deadline);
    }
  });
});
