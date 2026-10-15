import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Server } from 'socket.io';
import nodemailer from 'nodemailer';
import { env } from '../config.js';
import { ExpoPushGateway, pushRetryDelay } from './push.gateway.js';
import { logger } from '../utils/logger.js';

export type DeliveryJob = {
  id: string;
  notification_id: string;
  user_id: string;
  channel: 'IN_APP' | 'EMAIL' | 'PUSH';
  device_id: string | null;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  attempts: number;
  lease_token: string;
  provider_ticket: string | null;
};

export class DeliveryRepository {
  constructor(private readonly pool: Pool) {}
  async claim(limit = 20): Promise<DeliveryJob[]> {
    const result = await this.pool.query<DeliveryJob>(
      `WITH ready AS (
      SELECT id FROM notification_outbox WHERE
        (state IN ('READY','ACCEPTED') AND available_at<=now()) OR
        (state='PROCESSING' AND lease_until<=now())
      ORDER BY available_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE notification_outbox o SET state='PROCESSING',attempts=attempts+1,
        lease_token=$2,lease_until=now()+interval '120 seconds' FROM ready r WHERE o.id=r.id RETURNING o.*
    ) SELECT c.*,n.user_id,n.channel,n.title,n.body,n.payload
      FROM claimed c JOIN notifications n ON n.id=c.notification_id`,
      [limit, randomUUID()],
    );
    return result.rows;
  }
  async email(userId: string) {
    const result = await this.pool.query<{ email: string }>(
      `SELECT email FROM users WHERE id=$1 AND status='ACTIVE' AND email_verified_at IS NOT NULL`,
      [userId],
    );
    return result.rows[0]?.email;
  }
  async device(job: DeliveryJob) {
    const result = await this.pool.query<{ token: string }>(
      `SELECT d.expo_push_token AS token FROM notification_devices d
      JOIN sessions s ON s.id=d.session_id JOIN users u ON u.id=d.user_id
      WHERE d.id=$1 AND d.user_id=$2 AND u.status='ACTIVE' AND s.revoked_at IS NULL
        AND s.expires_at>now() AND d.updated_at>=now()-interval '30 days'`,
      [job.device_id, job.user_id],
    );
    return result.rows[0]?.token;
  }
  async removeInvalidDevice(job: DeliveryJob, token: string) {
    await this.pool.query(
      'DELETE FROM notification_devices WHERE id=$1 AND user_id=$2 AND expo_push_token=$3',
      [job.device_id, job.user_id, token],
    );
  }
  async finish(
    job: DeliveryJob,
    state: 'SENT' | 'FAILED' | 'READY' | 'ACCEPTED',
    reason: string | null = null,
    ticket: string | null = job.provider_ticket,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '15s'");
      const result = await client.query(
        `UPDATE notification_outbox SET state=$3,lease_token=NULL,lease_until=NULL,
        available_at=now()+($4::integer*interval '1 millisecond'),provider_ticket=$5,last_error=$6,
        completed_at=CASE WHEN $3 IN ('SENT','FAILED') THEN now() ELSE NULL END
        WHERE id=$1 AND lease_token=$2 AND state='PROCESSING' RETURNING notification_id`,
        [
          job.id,
          job.lease_token,
          state,
          state === 'ACCEPTED' ? 900_000 : pushRetryDelay(job.attempts),
          ticket,
          reason,
        ],
      );
      if (result.rowCount) {
        // Serialize sibling device completion before aggregating their states.
        await client.query('SELECT id FROM notifications WHERE id=$1 FOR UPDATE', [
          job.notification_id,
        ]);
        await client.query(
          `UPDATE notifications n SET
          status=CASE WHEN n.status='READ' THEN 'READ'::notification_status
            WHEN EXISTS(SELECT 1 FROM notification_outbox o WHERE o.notification_id=n.id AND o.state IN ('READY','PROCESSING','ACCEPTED')) THEN 'PENDING'::notification_status
            WHEN EXISTS(SELECT 1 FROM notification_outbox o WHERE o.notification_id=n.id AND o.state='SENT') THEN 'SENT'::notification_status
            ELSE 'FAILED'::notification_status END,
          sent_at=CASE WHEN EXISTS(SELECT 1 FROM notification_outbox o WHERE o.notification_id=n.id AND o.state='SENT') THEN coalesce(sent_at,now()) ELSE sent_at END
          WHERE id=$1`,
          [job.notification_id],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

type Mailer = {
  sendMail(options: {
    to: string;
    subject: string;
    text: string;
    messageId: string;
  }): Promise<unknown>;
};
function configuredMailer(): Mailer | undefined {
  if (!env.SMTP_URL || !env.AUTH_EMAIL_FROM) return undefined;
  const url = new URL(env.SMTP_URL);
  return nodemailer.createTransport(
    {
      host: url.hostname,
      port: Number(url.port) || (url.protocol === 'smtps:' ? 465 : 587),
      secure: url.protocol === 'smtps:',
      auth: url.username
        ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }
        : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    },
    { from: env.AUTH_EMAIL_FROM },
  );
}
export class NotificationDeliveryWorker {
  private running = false;
  private task?: Promise<void>;
  constructor(
    private readonly repository: DeliveryRepository,
    private readonly getIO: () => Server | undefined,
    private readonly push = new ExpoPushGateway(env.EXPO_ACCESS_TOKEN),
    private readonly mailer: Mailer | undefined = configuredMailer(),
  ) {}
  start() {
    if (this.running) return;
    this.running = true;
    this.task = this.loop();
  }
  async stop() {
    this.running = false;
    await this.task;
  }
  async deliver(job: DeliveryJob) {
    try {
      if (job.attempts > 8) {
        await this.repository.finish(job, 'FAILED', 'RETRY_LIMIT');
        return;
      }
      if (job.channel === 'IN_APP') {
        const io = this.getIO();
        if (!io) throw new Error('Socket unavailable');
        io.to(`user:${job.user_id}`).emit('notification:new', {
          id: job.notification_id,
          channel: 'IN_APP',
          notification_type: 'PRICE_ALERT',
          title: job.title,
          body: job.body,
          payload: job.payload,
        });
        await this.repository.finish(job, 'SENT');
      } else if (job.channel === 'EMAIL') {
        const email = await this.repository.email(job.user_id);
        if (!email) {
          await this.repository.finish(job, 'FAILED', 'NO_VERIFIED_EMAIL');
          return;
        }
        if (!this.mailer) throw new Error('Email unavailable');
        await this.mailer.sendMail({
          to: email,
          subject: job.title,
          text: job.body + '\n\nView your notification history in Asteriq AI.',
          messageId: `<${job.notification_id}@notifications.asteriq.ai>`,
        });
        await this.repository.finish(job, 'SENT');
      } else {
        const token = await this.repository.device(job);
        if (!token) {
          await this.repository.finish(job, 'FAILED', 'DEVICE_UNAVAILABLE');
          return;
        }
        if (job.provider_ticket) {
          const receipts = await this.push.receipts([job.provider_ticket]);
          const receipt = receipts[job.provider_ticket];
          if (!receipt) {
            await this.repository.finish(job, 'ACCEPTED', 'RECEIPT_PENDING');
            return;
          }
          if (receipt.status === 'ok') {
            await this.repository.finish(job, 'SENT');
            return;
          }
          if (receipt.details?.error === 'DeviceNotRegistered')
            await this.repository.removeInvalidDevice(job, token);
          await this.repository.finish(job, 'FAILED', 'PUSH_RECEIPT_REJECTED');
        } else {
          const [ticket] = await this.push.send([
            { token, notificationId: job.notification_id, screen: 'Alerts' },
          ]);
          if (!ticket) throw new Error('Push ticket missing');
          if (ticket.status === 'ok')
            await this.repository.finish(job, 'ACCEPTED', null, ticket.id);
          else if (ticket.details?.error === 'DeviceNotRegistered') {
            await this.repository.removeInvalidDevice(job, token);
            await this.repository.finish(job, 'FAILED', 'DEVICE_NOT_REGISTERED');
          } else throw new Error('Push gateway rejected message');
        }
      }
    } catch {
      // Persist only a fixed code, never provider bodies, recipient addresses, or tokens.
      await this.repository.finish(
        job,
        job.attempts >= 8 ? 'FAILED' : job.provider_ticket ? 'ACCEPTED' : 'READY',
        'DELIVERY_UNAVAILABLE',
      );
    }
  }
  private async loop() {
    while (this.running) {
      try {
        // Small batches and bounded parallelism isolate slow external channels.
        const jobs = await this.repository.claim(5);
        await Promise.all(jobs.map((job) => this.deliver(job)));
      } catch (error) {
        logger.error('Notification delivery polling failed', {
          type: error instanceof Error ? error.name : 'unknown',
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
