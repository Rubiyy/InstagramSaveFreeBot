import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { bot } from './bot';
import { walletMenuCallbacks } from './connect-wallet-menu';
import { isAdmin } from './utils';
import { handleMediaMessage, handleAudioCommand } from './media-handlers';
import { 
    handleConnectCommand, 
    handleDisconnectCommand, 
    handleShowMyWalletCommand, 
    handleSendTXCommand, 
    handledonateCommand, 
    handleUsersCommand, 
    handleInfoCommand, 
    handleSupportCommand, 
    handlePayNowCommand, 
    handleApproveCommand, 
    handleRejectCommand, 
    handlepromotionCommand, 
    handleBackToMenuCallback 
} from './commands-handlers';
import { initRedisClient, trackUserInteraction } from './ton-connect/storage';
import TelegramBot from 'node-telegram-bot-api';
import { withErrorBoundary } from './error-boundary';
import { handleScheduleCommand } from './scheduler';



async function main(): Promise<void> {
    await initRedisClient();

    // Add global error handler for the bot
    process.on('uncaughtException', (error) => {
        console.error('UNCAUGHT EXCEPTION! Bot will continue running:', error);
    });

    process.on('unhandledRejection', (reason) => {
        console.error('UNHANDLED REJECTION! Bot will continue running:', reason);
    });

    // Add a global message handler to track all user interactions
    bot.on('message', async (msg) => {
        try {
            // Track any user interaction with the bot, including their display name and username
            const displayName = msg.from?.first_name || undefined;
            const username = msg.from?.username || undefined;
            await trackUserInteraction(msg.chat.id, displayName, username);
            
            // Handle media download requests if the message contains a supported URL
            if (msg.text && !msg.text.startsWith('/')) {
                await handleMediaMessage(bot, msg);
            }
        } catch (error) {
            console.error('Error in global message handler:', error);
        }
    });

    // Handle /a command for audio downloads
    bot.onText(/\/a/, withErrorBoundary(async (msg) => {
        await handleAudioCommand(bot, msg);
    }));

    const callbacks = {
        ...walletMenuCallbacks,
        back_to_menu: handleBackToMenuCallback
    };

    bot.on('callback_query', async query => {
        if (!query.data) {
            return;
        }

        // Track user interaction from callback queries
        if (query.from && query.from.id) {
            try {
                const displayName = query.from.first_name || undefined;
                const username = query.from.username || undefined;
                await trackUserInteraction(query.from.id, displayName, username);
            } catch (error) {
                console.error('Error tracking callback query interaction:', error);
            }
        }

        let request: { method: string; data: string };

        try {
            request = JSON.parse(query.data);
        } catch {
            return;
        }

        if (!callbacks[request.method as keyof typeof callbacks]) {
            return;
        }

        try {
        callbacks[request.method as keyof typeof callbacks](query, request.data);
    } catch (error) {
        console.error('Error handling callback query:', error);
        // Try to send a message to the user that something went wrong
        if (query.message) {
            try {
                await bot.sendMessage(query.message.chat.id, "Sorry, there was an error processing your request.");
            } catch (sendError) {
                console.error('Failed to send error message:', sendError);
            }
        }
    }
    });

    // Wrap all command handlers with error boundary
    bot.onText(/\/connect/, withErrorBoundary(handleConnectCommand));

    bot.onText(/\/send_tx/, withErrorBoundary(handleSendTXCommand));

    bot.onText(/\/disconnect/, withErrorBoundary(handleDisconnectCommand));

    bot.onText(/\/my_wallet/, withErrorBoundary(handleShowMyWalletCommand));

    // Handle custom donate amount command
    bot.onText(/\/donate/, withErrorBoundary(handledonateCommand));

    // Handle admin-only users command
    bot.onText(/\/users/, withErrorBoundary(handleUsersCommand));
    
    // Registration for new commands
    bot.onText(/\/info/, withErrorBoundary(handleInfoCommand));
    bot.onText(/\/support/, withErrorBoundary(handleSupportCommand));
    bot.onText(/\/pay_now/, withErrorBoundary(handlePayNowCommand));
    bot.onText(/\/approve/, withErrorBoundary(handleApproveCommand));
    bot.onText(/\/reject/, withErrorBoundary(handleRejectCommand));
    bot.onText(/\/promotion/, withErrorBoundary(handlepromotionCommand));
    
    // New scheduled messages command (admin-only)
    bot.onText(/\/schedule/, withErrorBoundary(handleScheduleCommand));

    bot.onText(/\/start/, (msg: TelegramBot.Message) => {
        const chatId = msg.chat.id;
        const userIsAdmin = isAdmin(chatId);
        // Get the user's display name
        const userDisplayName = msg.from?.first_name || 'Valued User';
        
        const baseMessage = `🎉 Welcome to InstagramSaveFreeBot, ${userDisplayName}!

Download Instagram or TikTok photos, videos, reels, and stories in just a tap. Fast, secure, and hassle-free. Just share the link and we'll handle the rest 🚀🔥

Commands list: 
/connect - Connect to a wallet
/my_wallet - Show connected wallet
/send_tx - Subscribe to enjoy unlimited access (1 TON)
/donate [amount] - Donate to support our engineers, e.g. /donate 5
/pay_now [transaction_id] - Submit a transaction ID / Hash
/promotion - Access the promotion portal
/disconnect - Disconnect from the wallet
/support [message] - Consult live support assistance
/info - Help & recommendations`;

        const adminCommands = `

Admin Commands:
/users - View connected users
/pay_now - View pending transactions
/approve [transaction_id] - Approve a transaction
/reject [transaction_id] - Reject a transaction
/schedule [time] [message] - Send scheduled messages (e.g., /schedule 10m Hello)`;

        const footer = `

Url: @InstagramSaveFreeBot`;

        const message = userIsAdmin ? baseMessage + adminCommands + footer : baseMessage + footer;
        
        bot.sendMessage(chatId, message);
    });
}

// Create a simple HTTP server to keep the bot alive on Render
const server = http.createServer((req, res) => {
    // Serve the manifest file directly from the app with CORS headers
    if (req.url === '/tonconnect-manifest.json') {
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end(JSON.stringify({
            url: process.env.TELEGRAM_BOT_LINK || "https://t.me/InstagramSaveFreeBot",
            name: "InstagramSaveFreeBot",
            iconUrl: "https://telegram.org/img/t_logo.png",
            termsOfUseUrl: process.env.TELEGRAM_BOT_LINK || "https://t.me/InstagramSaveFreeBot",
            privacyPolicyUrl: process.env.TELEGRAM_BOT_LINK || "https://t.me/InstagramSaveFreeBot"
        }));
        return;
    }
    
    // Handle OPTIONS requests for CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400'  // 24 hours
        });
        res.end();
        return;
    }
    
    // Add a basic health check endpoint
    if (req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
    }
    
    // Default response
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Telegram Bot is running!');
});

// Get port from environment variable or use 10000 as default
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`HTTP server running on port ${PORT}`);
});

// Start the bot
main();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Shutting down...');
    process.exit(0);
});
