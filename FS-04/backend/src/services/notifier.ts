import { logger } from '../lib/logger';

export interface Notification {
  to: { id: string; email: string; name: string };
  subject: string;
  body: string;
  type: string;
}

/** Pluggable delivery channel (email, Slack, ...). The default just logs. */
export interface Notifier {
  send(notification: Notification): Promise<void>;
}

export class LogNotifier implements Notifier {
  async send(n: Notification): Promise<void> {
    logger.info({ to: n.to.email, type: n.type, subject: n.subject }, `[notify] ${n.body}`);
  }
}

let notifier: Notifier = new LogNotifier();

export const getNotifier = (): Notifier => notifier;
export const setNotifier = (n: Notifier): void => {
  notifier = n;
};
