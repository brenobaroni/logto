import {
  AlterationState,
  alterationStateGuard,
  LogtoConfig,
  logtoConfigGuards,
  LogtoConfigKey,
  LogtoConfigs,
} from '@logto/schemas';
import { DatabasePool, DatabaseTransactionConnection, sql } from 'slonik';
import { z } from 'zod';

import { convertToIdentifiers } from '../database';

const { table, fields } = convertToIdentifiers(LogtoConfigs);

export const getRowsByKeys = async (
  pool: DatabasePool | DatabaseTransactionConnection,
  keys: LogtoConfigKey[]
) =>
  pool.query<LogtoConfig>(sql`
    select ${sql.join([fields.key, fields.value], sql`,`)} from ${table}
      where ${fields.key} in (${sql.join(keys, sql`,`)})
  `);

export const updateValueByKey = async <T extends LogtoConfigKey>(
  pool: DatabasePool | DatabaseTransactionConnection,
  key: T,
  value: z.infer<typeof logtoConfigGuards[T]>
) =>
  pool.query(
    sql`
      insert into ${table} (${fields.key}, ${fields.value}) 
        values (${key}, ${sql.jsonb(value)})
        on conflict (${fields.key}) do update set ${fields.value}=excluded.${fields.value}
    `
  );

export const getCurrentDatabaseAlterationTimestamp = async (pool: DatabasePool) => {
  try {
    const result = await pool.maybeOne<LogtoConfig>(
      sql`select * from ${table} where ${fields.key}=${LogtoConfigKey.AlterationState}`
    );
    const parsed = alterationStateGuard.safeParse(result?.value);

    return (parsed.success && parsed.data.timestamp) || 0;
  } catch (error: unknown) {
    const result = z.object({ code: z.string() }).safeParse(error);

    // Relation does not exist, treat as 0
    // https://www.postgresql.org/docs/14/errcodes-appendix.html
    if (result.success && result.data.code === '42P01') {
      return 0;
    }

    throw error;
  }
};

export const updateDatabaseTimestamp = async (
  connection: DatabaseTransactionConnection,
  timestamp: number
) => {
  const value: AlterationState = {
    timestamp,
    updatedAt: new Date().toISOString(),
  };

  return updateValueByKey(connection, LogtoConfigKey.AlterationState, value);
};
