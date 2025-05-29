import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// Define supported media link patterns
const SUPPORTED_MEDIA_PATTERNS = [
    /https:\/\/www\.youtube\.com\//,
    /https:\/\/youtu\.be\//,
    /https:\/\/www\.youtube\.com\/shorts\//,
    /https:\/\/youtube\.com\/shorts\//,
    /https:\/\/www\.tiktok\.com\//,
    /https:\/\/vt\.tiktok\.com\//,
    /https:\/\/vm\.tiktok\.com\//,
    /https:\/\/www\.instagram\.com\/reel\//,
    /https:\/\/instagram\.com\/reel\//,
    /https:\/\/www\.instagram\.com\/share\//,
    /https:\/\/x\.com\//,
    /https:\/\/twitter\.com\//,
];

// Check if a message contains a supported media link
export function containsMediaLink(text: string): boolean {
    if (!text) return false;
    return SUPPORTED_MEDIA_PATTERNS.some(pattern => pattern.test(text));
}

// Function to download media using the downloader service
export async function downloadMedia(url: string, quality: string, chatId: number, userId: number): Promise<any> {
    return new Promise((resolve, reject) => {
        const serviceScriptPath = path.join(__dirname, '..', 'src', 'youtube-dl-bot', 'bot', 'downloader_service.py');
        console.log(`Running downloader service from: ${serviceScriptPath}`);
        
        const process = spawn('python', [serviceScriptPath, url, quality, chatId.toString(), userId.toString()], {
            stdio: 'pipe',
        });
        
        let outputData = '';
        let jsonResults: any[] = [];
        
        process.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(`Downloader Service Output: ${output.trim()}`);
            outputData += output;
            
            // Try to extract JSON objects on each output chunk
            const lines = output.split('\n');
            for (const line of lines) {
                if (line.trim().startsWith('{')) {
                    try {
                        const jsonObj = JSON.parse(line.trim());
                        console.log('Found JSON result:', jsonObj);
                        jsonResults.push(jsonObj);
                    } catch (err) {
                        // Ignore parse errors for incomplete JSON
                    }
                }
            }
        });
        
        process.stderr.on('data', (data) => {
            console.error(`Downloader Service Error: ${data.toString().trim()}`);
        });
        
        process.on('close', (code) => {
            console.log(`Downloader service process exited with code ${code}`);
            if (code === 0) {
                // If we already found JSON objects in the output stream, use those
                if (jsonResults.length > 0) {
                    console.log(`Returning ${jsonResults.length} results found during processing`);
                    resolve(jsonResults);
                    return;
                }
                
                // Otherwise try to parse from the complete output
                try {
                    const jsonResponses = outputData.split('\n')
                        .filter(line => line.trim().startsWith('{'))
                        .map(line => {
                            try {
                                return JSON.parse(line.trim());
                            } catch (e) {
                                console.error('Failed to parse JSON line:', line.trim(), e);
                                return null;
                            }
                        })
                        .filter(obj => obj !== null);
                    
                    console.log(`Found ${jsonResponses.length} JSON responses after parsing complete output`);
                    resolve(jsonResponses);
                } catch (err) {
                    console.error('Failed to parse downloader output:', err);
                    resolve([]); // Return empty array if parsing fails
                }
            } else {
                reject(new Error(`Downloader service failed with code ${code}`));
            }
        });
    });
}

// Main handler for media download requests
export async function handleMediaMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || chatId;
    const text = msg.text || '';
    
    // Ignore non-link messages
    if (!containsMediaLink(text)) {
        return;
    }
    
    const statusMessage = await bot.sendMessage(chatId, '⏳ Processing your media request...');
    
    try {
        const url = text.trim();
        const quality = text.startsWith('a ') ? 'audio' : 'video';
        
        // Send message that we're starting the download
        await bot.sendMessage(chatId, `⏱️ Starting download for: ${url}\nThis may take a moment...`);
        
        // Process the media download
        const results = await downloadMedia(url, quality, chatId, userId);
        console.log('Download results:', results);
        
        if (results && results.length > 0) {
            for (const result of results) {
                console.log('Processing result:', result);
                if (result.type === 'video' || result.type === 'audio') {
                    const filePath = result.file;
                    console.log(`Checking file path: ${filePath}`);
                    
                    if (!fs.existsSync(filePath)) {
                        console.error(`File not found: ${filePath}`);
                        await bot.sendMessage(chatId, `❌ File not found: ${filePath}`);
                        continue;
                    }
                    
                    try {
                        console.log(`Sending ${result.type} file: ${filePath}`);
                        if (result.type === 'video') {
                            await bot.sendMessage(chatId, '📹 Sending video, please wait...');
                            await bot.sendVideo(chatId, filePath, {
                                caption: '📹 Video downloaded by @InstagramSaveFreeBot'
                            });
                        } else {
                            await bot.sendMessage(chatId, '🎵 Sending audio, please wait...');
                            await bot.sendAudio(chatId, filePath, {
                                caption: '🎵 Audio downloaded by @InstagramSaveFreeBot'
                            });
                        }
                        console.log(`Successfully sent ${result.type}`);
                    } catch (sendError) {
                        console.error(`Error sending ${result.type}:`, sendError);
                        await bot.sendMessage(chatId, `❌ Error sending ${result.type}: ${sendError instanceof Error ? sendError.message : String(sendError)}`);
                        
                        // Try to send as a document as fallback
                        try {
                            await bot.sendMessage(chatId, '🔄 Trying to send as a document instead...');
                            await bot.sendDocument(chatId, filePath, {
                                caption: `${result.type === 'video' ? '📹' : '🎵'} Media downloaded by @InstagramSaveFreeBot`
                            });
                        } catch (docError) {
                            console.error('Error sending as document:', docError);
                            await bot.sendMessage(chatId, '❌ Failed to send the media file. The file might be too large or in an unsupported format.');
                        }
                    }
                    
                    // Delete the file after sending
                    try {
                        fs.unlinkSync(filePath);
                        console.log(`Deleted file: ${filePath}`);
                    } catch (err) {
                        console.error(`Failed to delete file ${filePath}:`, err);
                    }
                } else if (result.type === 'error') {
                    await bot.sendMessage(chatId, `❌ Error: ${result.message}`);
                }
            }
        } else {
            await bot.sendMessage(chatId, '❌ Failed to process the media. Please check the URL and try again.');
        }
        
        // Clean up status message
        await bot.deleteMessage(chatId, statusMessage.message_id);
        
    } catch (error) {
        console.error('Error handling media message:', error);
        await bot.sendMessage(chatId, `❌ An error occurred while processing your request: ${error instanceof Error ? error.message : String(error)}`);
        await bot.deleteMessage(chatId, statusMessage.message_id);
    }
}

// Handler for the /a command (audio download)
export async function handleAudioCommand(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || chatId;
    const text = msg.text || '';
    
    // Extract URL from command
    const match = text.match(/\/a\s+(.+)/);
    if (!match || !match[1]) {
        await bot.sendMessage(chatId, '❌ Please provide a URL after the /a command. Example: /a https://youtube.com/watch?v=...');
        return;
    }
    
    const url = match[1].trim();
    const statusMessage = await bot.sendMessage(chatId, '⏳ Processing your audio request...');
    
    try {
        // Send message that we're starting the download
        await bot.sendMessage(chatId, `⏱️ Starting audio download for: ${url}\nThis may take a moment...`);
        
        // Process the audio download
        const results = await downloadMedia(url, 'audio', chatId, userId);
        console.log('Audio download results:', results);
        
        if (results && results.length > 0) {
            for (const result of results) {
                console.log('Processing audio result:', result);
                if (result.type === 'audio') {
                    const filePath = result.file;
                    console.log(`Checking audio file path: ${filePath}`);
                    
                    if (!fs.existsSync(filePath)) {
                        console.error(`File not found: ${filePath}`);
                        await bot.sendMessage(chatId, `❌ File not found: ${filePath}`);
                        continue;
                    }
                    
                    try {
                        console.log(`Sending audio file: ${filePath}`);
                        await bot.sendMessage(chatId, '🎵 Sending audio, please wait...');
                        await bot.sendAudio(chatId, filePath, {
                            caption: '🎵 Audio downloaded by @InstagramSaveFreeBot'
                        });
                        console.log('Successfully sent audio');
                    } catch (sendError) {
                        console.error('Error sending audio:', sendError);
                        await bot.sendMessage(chatId, `❌ Error sending audio: ${sendError instanceof Error ? sendError.message : String(sendError)}`);
                        
                        // Try to send as a document as fallback
                        try {
                            await bot.sendMessage(chatId, '🔄 Trying to send as a document instead...');
                            await bot.sendDocument(chatId, filePath, {
                                caption: '🎵 Audio downloaded by @InstagramSaveFreeBot'
                            });
                        } catch (docError) {
                            console.error('Error sending as document:', docError);
                            await bot.sendMessage(chatId, '❌ Failed to send the audio file. The file might be too large or in an unsupported format.');
                        }
                    }
                    
                    // Delete the file after sending
                    try {
                        fs.unlinkSync(filePath);
                        console.log(`Deleted file: ${filePath}`);
                    } catch (err) {
                        console.error(`Failed to delete file ${filePath}:`, err);
                    }
                } else if (result.type === 'error') {
                    await bot.sendMessage(chatId, `❌ Error: ${result.message}`);
                }
            }
        } else {
            await bot.sendMessage(chatId, '❌ Failed to process the audio. Please check the URL and try again.');
        }
        
        // Clean up status message
        await bot.deleteMessage(chatId, statusMessage.message_id);
        
    } catch (error) {
        console.error('Error handling audio command:', error);
        await bot.sendMessage(chatId, `❌ An error occurred while processing your request: ${error instanceof Error ? error.message : String(error)}`);
        await bot.deleteMessage(chatId, statusMessage.message_id);
    }
}
