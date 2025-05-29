import TelegramBot from 'node-telegram-bot-api';
import { bot } from './bot';
import { isAdmin } from './utils';

/**
 * Error boundary wrapper for bot command handlers
 * Prevents errors in individual commands from crashing the entire bot
 * 
 * @param handler The original command handler function
 * @returns A wrapped function that catches errors
 */
export function withErrorBoundary<T extends any[]>(
  handler: (...args: T) => Promise<void>
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await handler(...args);
    } catch (error) {
      console.error(`Error in command handler: ${error instanceof Error ? error.message : error}`);
      console.error(error);

      // Try to extract chatId from the arguments (assuming first arg is Message or CallbackQuery)
      let chatId: number | undefined;
      
      if (args.length > 0) {
        const firstArg = args[0];
        
        if (firstArg && typeof firstArg === 'object') {
          // For normal messages
          if ('chat' in firstArg && firstArg.chat && 'id' in firstArg.chat) {
            chatId = firstArg.chat.id;
          }
          // For callback queries
          else if ('message' in firstArg && 
                   firstArg.message && 
                   'chat' in firstArg.message && 
                   firstArg.message.chat &&
                   'id' in firstArg.message.chat) {
            chatId = firstArg.message.chat.id;
          }
        }
      }

      if (chatId) {
        try {
          // Send a user-friendly error message
          await bot.sendMessage(
            chatId,
            "⚠️ There was a problem processing your request. Please try again later."
          );
          
          // Notify admin(s) about the error
          const adminIds = process.env.ADMIN_IDS?.split(',').map(id => Number(id.trim())) || [];
          if (adminIds.length > 0) {
            const errorDetails = `
🔴 *Bot Error Report*

*Error Type*: ${error instanceof Error ? error.name : 'Unknown'}
*Message*: ${error instanceof Error ? error.message : String(error)}
*User ID*: ${chatId}
*Command*: ${args[0]?.text || 'Unknown'}
*Time*: ${new Date().toISOString()}`;

            for (const adminId of adminIds) {
              try {
                if (adminId !== chatId || isAdmin(chatId)) {
                  await bot.sendMessage(adminId, errorDetails, { parse_mode: 'Markdown' });
                }
              } catch (notifyError) {
                console.error(`Failed to notify admin ${adminId} about error:`, notifyError);
              }
            }
          }
        } catch (sendError) {
          console.error('Error sending error notification:', sendError);
        }
      }
    }
  };
}

/**
 * Safe message sender that handles Markdown parsing errors
 * If sending with Markdown fails, it will retry without Markdown
 */
export async function safeSendMessage(
  chatId: number, 
  text: string, 
  options?: TelegramBot.SendMessageOptions
): Promise<TelegramBot.Message> {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (error) {
    if (
      error && 
      typeof error === 'object' && 
      'message' in error && 
      typeof error.message === 'string' && 
      error.message.includes('parse entities')
    ) {
      console.warn('Markdown parsing error, retrying without markdown formatting');
      
      // Try again without markdown parsing
      const safeOptions = { ...options };
      if (safeOptions.parse_mode) {
        delete safeOptions.parse_mode;
      }
      
      // Add a note about formatting
      return await bot.sendMessage(
        chatId, 
        text + "\n\n(Note: Some formatting was removed due to technical issues)", 
        safeOptions
      );
    }
    
    // If it's another kind of error, rethrow it
    throw error;
  }
}
