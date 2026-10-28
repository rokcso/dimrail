import { readFileSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

class TestStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly statement: StatementSync,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): TestStatement {
    return new TestStatement(this.database, this.statement, params);
  }

  async first<T>(): Promise<T | null> {
    return (this.statement.get(...(this.params as never[])) as T) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.statement.all(...(this.params as never[])) as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const result = this.statement.run(...(this.params as never[]));
    return { meta: { changes: Number(result.changes) } };
  }
}

export class TestD1 {
  readonly database: DatabaseSync;

  constructor() {
    this.database = new DatabaseSync(':memory:');
    this.database.exec('PRAGMA foreign_keys = ON');
    this.database.exec(
      readFileSync(new URL('../migrations/0000_init.sql', import.meta.url), 'utf8'),
    );
  }

  prepare(sql: string): TestStatement {
    return new TestStatement(this.database, this.database.prepare(sql));
  }

  async batch(statements: TestStatement[]): Promise<unknown[]> {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }
}
