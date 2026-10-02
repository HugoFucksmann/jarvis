import { Bot, type Message } from 'node-telegram-bot-api';
import { AgentCore } from '../agent/AgentCore.js';
import { Logger } from '../logger/Logger.js';

const logger = new Logger('TelegramBot');

/** Maximum Telegram message length. */
const MAX_MSG_LENGTH = 4096;

/**
 * Splits a long text into chunks of at most MAX_MSG_LENGTH characters,
 * breaking on newlines where possible.
 */
function splitMessage(text: string): string[] {
  if (text.length <= MAX_MSG_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MSG_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to break at the last newline within the limit.
    let cutAt = remaining.lastIndexOf('\n', MAX_MSG_LENGTH);

    if (cutAt <= 0) {
      cutAt = MAX_MSG_LENGTH;
    }

    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trimStart();
  }

  return chunks;
}

/**
 * Starts the Telegram bot using long polling.
 *
 * Each Telegram chat_id is used as the JARVIS session ID so that
 * conversation history remains isolated per chat.
 *
 * SECURITY:
 * TELEGRAM_TOKEN is consumed only here and is never passed to
 * AgentCore, ToolRegistry, or the LLM.
 */
export function startTelegramBot(agentCore: AgentCore): Bot | null {
  const token = process.env.TELEGRAM_TOKEN;

  if (!token) {
    logger.warn('TELEGRAM_TOKEN not set — Telegram bot will not start.');
    return null;
  }

  // node-telegram-bot-api v2 uses Bot + startPolling().
  const bot = new Bot(token);

  // Track chats that currently have a running JARVIS task.
  const activeTasks = new Set<number>();

  bot.on('message', async (ctx) => {
    const message: Message | undefined = ctx.message;

    if (!message) {
      return;
    }

    const chatId = message.chat.id;
    const text = message.text?.trim();

    // Ignore non-text messages.
    if (!text) {
      return;
    }

    // Avoid running multiple JARVIS tasks simultaneously for the same chat.
    if (activeTasks.has(chatId)) {
      await ctx.reply(
        '⏳ Todavía estoy procesando tu mensaje anterior. Por favor, esperá.',
      );
      return;
    }

    activeTasks.add(chatId);

    // Typing indicator.
    let typingInterval: ReturnType<typeof setInterval> | null = setInterval(
      () => {
        bot.api
          .sendChatAction({
            chat_id: chatId,
            action: 'typing',
          })
          .catch(() => { });
      },
      4000,
    );

    // Send typing indicator immediately.
    bot.api
      .sendChatAction({
        chat_id: chatId,
        action: 'typing',
      })
      .catch(() => { });

    try {
      // Each Telegram chat gets its own JARVIS session.
      const sessionId = `telegram_${chatId}`;

      logger.info(
        `[chat:${chatId}] Received: "${text.substring(0, 80)}"`,
      );

      const result = await agentCore.runTask(text, sessionId);

      const responseText = result.success
        ? result.response || 'Tarea completada.'
        : `❌ Error: ${result.error || 'Error desconocido.'}`;

      // Telegram has a 4096-character message limit.
      const chunks = splitMessage(responseText);

      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }

      logger.info(
        `[chat:${chatId}] Responded in ${result.durationMs}ms`,
      );
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);

      logger.error(
        `[chat:${chatId}] Unhandled error: ${errorMessage}`,
      );

      try {
        await ctx.reply(
          '❌ Ocurrió un error inesperado. Intentá de nuevo.',
        );
      } catch {
        // Ignore errors while attempting to report the error.
      }
    } finally {
      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
      }

      activeTasks.delete(chatId);
    }
  });

  // Global middleware error boundary.
  bot.catch((err) => {
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    logger.error(`Telegram bot error: ${errorMessage}`);
  });

  // Start long polling.
  void bot.startPolling().catch((err: unknown) => {
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    logger.error(`Telegram polling error: ${errorMessage}`);
  });

  logger.info(
    'Telegram bot started (long polling). Waiting for messages...',
  );

  return bot;
}