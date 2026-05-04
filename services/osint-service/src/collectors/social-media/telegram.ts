// ──────────────────────────────────────────────────────────────
// sentinel-os/services/osint-service/src/collectors/social-media/telegram.ts
// Telegram OSINT — public channel monitoring via Telegram Bot API
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'telegram-collector' });

export interface TelegramMessage {
  messageId: number;
  chatId: number;
  chatTitle: string;
  date: number;
  text: string | null;
  author: string | null;
  mediaType: string | null;
  views: number | null;
  forwards: number | null;
}

export class TelegramCollector {
  private readonly botToken: string;
  private readonly baseUrl: string;
  private monitoredChats: number[] = [];
  private lastUpdateId = 0;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
    if (!this.botToken) {
      logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram monitoring disabled');
    }

    const chats = process.env.TELEGRAM_MONITORED_CHATS || '';
    if (chats) {
      this.monitoredChats = chats.split(',').map(Number).filter((n: number) => !isNaN(n));
    }
  }

  isAvailable(): boolean {
    return !!this.botToken;
  }

  async getUpdates(): Promise<TelegramMessage[]> {
    if (!this.botToken) return [];

    try {
      const { data } = await axios.get(`${this.baseUrl}/getUpdates`, {
        params: {
          offset: this.lastUpdateId + 1,
          limit: 100,
          timeout: 10,
        },
        timeout: 15000,
      });

      const messages: TelegramMessage[] = [];

      for (const update of data.result || []) {
        if (update.update_id) {
          this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
        }

        const msg = update.message || update.channel_post;
        if (!msg) continue;

        // Filter to monitored chats if configured
        if (this.monitoredChats.length > 0 && !this.monitoredChats.includes(msg.chat?.id)) {
          continue;
        }

        messages.push({
          messageId: msg.message_id,
          chatId: msg.chat?.id,
          chatTitle: msg.chat?.title || msg.chat?.username || 'DM',
          date: msg.date,
          text: msg.text || msg.caption || null,
          author: msg.from?.username || msg.from?.first_name || null,
          mediaType: msg.photo ? 'photo' : msg.video ? 'video' : msg.document ? 'document' : null,
          views: msg.views || null,
          forwards: msg.forward_count || null,
        });
      }

      return messages;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Telegram getUpdates failed');
      return [];
    }
  }

  async searchChannel(chatId: number, query: string, limit = 20): Promise<TelegramMessage[]> {
    // Note: Telegram Bot API doesn't support search directly
    // This would require MTProto client for full search capability
    logger.info({ chatId, query }, 'Channel search requested (requires MTProto for full search)');
    return [];
  }

  addMonitoredChat(chatId: number): void {
    if (!this.monitoredChats.includes(chatId)) {
      this.monitoredChats.push(chatId);
    }
  }

  removeMonitoredChat(chatId: number): void {
    this.monitoredChats = this.monitoredChats.filter((id: number) => id !== chatId);
  }
}
