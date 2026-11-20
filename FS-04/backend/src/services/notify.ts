import { enqueue, QUEUES } from '../lib/queue';

export interface NotificationJobData {
  type: 'issue.assigned' | 'comment.created';
  workspaceId: string;
  recipientId: string;
  issueId: string;
  issueKey: string;
  title: string;
  actorName?: string;
  excerpt?: string;
}

export function queueNotification(data: NotificationJobData): void {
  enqueue(QUEUES.notifications, data.type, data);
}
