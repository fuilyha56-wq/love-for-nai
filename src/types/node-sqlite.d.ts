declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): {
      all(...parameters: Array<string | number | null>): Array<Record<string, unknown>>;
      get(...parameters: Array<string | number | null>): Record<string, unknown> | undefined;
      run(...parameters: Array<string | number | null>): { changes: number | bigint; lastInsertRowid: number | bigint };
    };
    close(): void;
  }
}
