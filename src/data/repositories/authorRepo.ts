import type { SqlDriver } from '../driver';
import type { Author, AuthorKind } from '../../domain/types';
import { toAuthor } from '../rows';
import { nowIso, uuid } from '../../lib/ids';

export interface NewAuthor {
  displayName: string;
  handle?: string | null;
  kind?: AuthorKind;
  notes?: string | null;
}

export class AuthorRepo {
  constructor(private db: SqlDriver) {}

  list(): Author[] {
    return this.db
      .select('SELECT * FROM authors WHERE deleted_at IS NULL ORDER BY display_name COLLATE NOCASE')
      .map(toAuthor);
  }

  getById(id: string): Author | null {
    const rows = this.db.select('SELECT * FROM authors WHERE id = ?', [id]);
    return rows[0] ? toAuthor(rows[0]) : null;
  }

  findByName(displayName: string): Author | null {
    const rows = this.db.select(
      'SELECT * FROM authors WHERE deleted_at IS NULL AND display_name = ? COLLATE NOCASE LIMIT 1',
      [displayName],
    );
    return rows[0] ? toAuthor(rows[0]) : null;
  }

  create(input: NewAuthor): Author {
    const now = nowIso();
    const author: Author = {
      id: uuid(),
      displayName: input.displayName.trim(),
      handle: input.handle?.trim() || null,
      kind: input.kind ?? 'person',
      avatarPath: null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.db.run(
      `INSERT INTO authors (id, display_name, handle, kind, avatar_path, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        author.id,
        author.displayName,
        author.handle,
        author.kind,
        author.avatarPath,
        author.notes,
        author.createdAt,
        author.updatedAt,
      ],
    );
    return author;
  }

  /** Reuse an existing author with this name rather than creating duplicates. */
  findOrCreate(input: NewAuthor): Author {
    return this.findByName(input.displayName) ?? this.create(input);
  }

  rename(id: string, displayName: string, handle: string | null): void {
    this.db.run('UPDATE authors SET display_name = ?, handle = ?, updated_at = ? WHERE id = ?', [
      displayName.trim(),
      handle?.trim() || null,
      nowIso(),
      id,
    ]);
  }

  softDelete(id: string): void {
    const now = nowIso();
    this.db.run('UPDATE authors SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
  }
}
