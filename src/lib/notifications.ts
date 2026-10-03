/**
 * Notification channels. MVP channels are mocks that write to the `notifications` log,
 * visible in the admin « Messages envoyés (démo) » panel. Real WhatsApp Business API /
 * SMS / email adapters implement the same interface.
 */
import type { NotificationChannelName, NotificationEvent, NotificationLog } from './types';

export interface OutgoingMessage {
  event: NotificationEvent;
  recipient: string;
  body: string;
  businessId: string | null;
  appointmentId: string | null;
}

export interface NotificationChannel {
  readonly name: NotificationChannelName;
  send(message: OutgoingMessage): Promise<void>;
}

export class MockChannel implements NotificationChannel {
  constructor(readonly name: NotificationChannelName, private sink: (log: Omit<NotificationLog, 'id' | 'createdAt'>) => void) {}
  async send(m: OutgoingMessage) {
    this.sink({ channel: this.name, ...m });
  }
}

/** Which channel carries which event in the MVP. */
export const EVENT_CHANNEL: Record<NotificationEvent, NotificationChannelName> = {
  booking_confirmed: 'whatsapp',
  reminder_d1: 'whatsapp',
  booking_cancelled: 'sms',
  new_booking_salon: 'whatsapp',
};
