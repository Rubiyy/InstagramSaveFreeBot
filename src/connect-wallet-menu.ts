import TelegramBot, { CallbackQuery } from 'node-telegram-bot-api';
import { getWalletInfo, getWallets } from './ton-connect/wallets';
import { bot } from './bot';
import { getConnector } from './ton-connect/connector';
import QRCode from 'qrcode';
import * as fs from 'fs';
import { isTelegramUrl, isWalletInfoRemote } from '@tonconnect/sdk';
import { addTGReturnStrategy, buildUniversalKeyboard } from './utils';
import { safeSendMessage } from './error-boundary';

export const walletMenuCallbacks = {
    chose_wallet: onChooseWalletClick,
    select_wallet: onWalletClick,
    universal_qr: onOpenUniversalQRClick
};
async function onChooseWalletClick(query: CallbackQuery, _: string): Promise<void> {
    if (!query.message) {
        console.error('onChooseWalletClick: Message is undefined');
        return;
    }
    
    const chatId = query.message.chat.id;
    
    try {
        const wallets = await getWallets();

        await bot.editMessageReplyMarkup(
            {
                inline_keyboard: [
                    wallets.map(wallet => ({
                        text: wallet.name,
                        callback_data: JSON.stringify({ method: 'select_wallet', data: wallet.appName })
                    })),
                    [
                        {
                            text: '« Back',
                            callback_data: JSON.stringify({
                                method: 'universal_qr'
                            })
                        }
                    ]
                ]
            },
            {
                message_id: query.message.message_id,
                chat_id: chatId
            }
        );
    } catch (error) {
        console.error('Error in onChooseWalletClick:', error);
        
        // Send a new message if edit fails
        try {
            await safeSendMessage(chatId, 
                'Sorry, there was an error displaying wallet options. Please try /connect again.'
            );
        } catch (sendError) {
            console.error('Failed to send error message in onChooseWalletClick:', sendError);
        }
    }
}

async function onOpenUniversalQRClick(query: CallbackQuery, _: string): Promise<void> {
    if (!query.message) {
        console.error('onOpenUniversalQRClick: Message is undefined');
        return;
    }
    
    const chatId = query.message.chat.id;
    
    try {
        const wallets = await getWallets();
        const connector = getConnector(chatId);
        const link = connector.connect(wallets);

        try {
            await editQR(query.message, link);
        } catch (qrError) {
            console.error('Error generating QR code:', qrError);
            // Continue with buttons even if QR fails
        }

        const keyboard = await buildUniversalKeyboard(link, wallets);

        await bot.editMessageReplyMarkup(
            {
                inline_keyboard: [keyboard]
            },
            {
                message_id: query.message.message_id,
                chat_id: chatId
            }
        );
    } catch (error) {
        console.error('Error in onOpenUniversalQRClick:', error);
        
        try {
            await safeSendMessage(chatId, 
                'Sorry, there was an error displaying connection options. Please try /connect again.'
            );
        } catch (sendError) {
            console.error('Failed to send error message in onOpenUniversalQRClick:', sendError);
        }
    }
}

async function onWalletClick(query: CallbackQuery, data: string): Promise<void> {
    if (!query.message) {
        console.error('onWalletClick: Message is undefined');
        return;
    }
    
    const chatId = query.message.chat.id;
    
    try {
        const connector = getConnector(chatId);

        const selectedWallet = await getWalletInfo(data);
        if (!selectedWallet) {
            await safeSendMessage(chatId, 'Selected wallet could not be found. Please try /connect again.');
            return;
        }

        let buttonLink = connector.connect({
            bridgeUrl: selectedWallet.bridgeUrl,
            universalLink: selectedWallet.universalLink
        });

        let qrLink = buttonLink;

        if (isTelegramUrl(selectedWallet.universalLink)) {
            // Check if bot link is available
            const botLink = process.env.TELEGRAM_BOT_LINK || 'https://t.me/your_bot';
            buttonLink = addTGReturnStrategy(buttonLink, botLink);
            qrLink = addTGReturnStrategy(qrLink, 'none');
        }

        try {
            await editQR(query.message, qrLink);
        } catch (qrError) {
            console.error('Error generating QR code in onWalletClick:', qrError);
            // Continue with buttons even if QR fails
        }

        await bot.editMessageReplyMarkup(
            {
                inline_keyboard: [
                    [
                        {
                            text: '« Back',
                            callback_data: JSON.stringify({ method: 'chose_wallet' })
                        },
                        {
                            text: `Open ${selectedWallet.name}`,
                            url: buttonLink
                        }
                    ]
                ]
            },
            {
                message_id: query.message.message_id,
                chat_id: chatId
            }
        );
    } catch (error) {
        console.error('Error in onWalletClick:', error);
        
        try {
            await safeSendMessage(chatId, 
                'Sorry, there was an error setting up wallet connection. Please try /connect again.'
            );
        } catch (sendError) {
            console.error('Failed to send error message in onWalletClick:', sendError);
        }
    }
}

async function editQR(message: TelegramBot.Message, link: string): Promise<void> {
    if (!message || !message.message_id || !message.chat) {
        throw new Error('Invalid message object for QR generation');
    }
    
    const fileName = 'QR-code-' + Math.round(Math.random() * 10000000000);
    
    try {
        await QRCode.toFile(`./${fileName}`, link);
        
        await bot.editMessageMedia(
            {
                type: 'photo',
                media: `attach://${fileName}`
            },
            {
                message_id: message.message_id,
                chat_id: message.chat.id
            }
        );
    } finally {
        // Make sure we clean up the file even if there's an error
        try {
            if (fs.existsSync(`./${fileName}`)) {
                await new Promise<void>(resolve => {
                    fs.rm(`./${fileName}`, (err) => {
                        if (err) {
                            console.error(`Failed to remove QR file ${fileName}:`, err);
                        }
                        resolve();
                    });
                });
            }
        } catch (cleanupError) {
            console.error('Error during QR file cleanup:', cleanupError);
        }
    }
}
