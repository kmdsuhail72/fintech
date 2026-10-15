import type { Pool } from 'pg';
import { notFound } from '../utils/errors.js';
export class PushDeviceRepository {
  constructor(private readonly pool: Pool) {}
  async register(
    userId: string,
    sessionId: string,
    input: { installationId: string; token: string; platform: 'ios' | 'android' },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM notification_devices d USING sessions s
        WHERE d.session_id = s.id AND d.expo_push_token = $1
          AND (s.revoked_at IS NOT NULL OR s.expires_at <= now())`,
        [input.token],
      );
      const result = await client.query(
        `INSERT INTO notification_devices (user_id, session_id, installation_id, expo_push_token, platform)
        SELECT $1, s.id, $3, $4, $5 FROM sessions s
        WHERE s.id = $2 AND s.user_id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
        ON CONFLICT (user_id, installation_id) DO UPDATE SET session_id = EXCLUDED.session_id,
          expo_push_token = EXCLUDED.expo_push_token, platform = EXCLUDED.platform, updated_at = now()
        RETURNING installation_id AS "installationId"`,
        [userId, sessionId, input.installationId, input.token, input.platform],
      );
      if (!result.rowCount) throw notFound('Active session');
      await client.query('COMMIT');
      return { installationId: input.installationId, registered: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async unregister(userId: string, installationId: string) {
    await this.pool.query(
      'DELETE FROM notification_devices WHERE user_id = $1 AND installation_id = $2',
      [userId, installationId],
    );
  }
  async eligibleForUser(userId: string) {
    const result = await this.pool.query<{ id: string; token: string }>(
      `SELECT d.id, d.expo_push_token AS token FROM notification_devices d
      JOIN sessions s ON s.id = d.session_id WHERE d.user_id = $1 AND s.revoked_at IS NULL
        AND s.expires_at > now() AND d.updated_at >= now() - interval '30 days'`,
      [userId],
    );
    return result.rows;
  }
}
