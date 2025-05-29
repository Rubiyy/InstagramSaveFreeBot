import asyncio
import logging
import os
import sys
import json
import shutil
import time
import tempfile
from pathlib import Path

import yt_dlp
from yt_dlp.utils import YoutubeDLError
import videoprops
from aiogram import types, Bot
from aiogram.client.default import DefaultBotProperties
from handlers.downloader import Downloader

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="[YouTubeDL-Service] %(message)s - %(asctime)s",
    datefmt="%H:%M:%S",
)

# Mock message class to pass to the Downloader
class MockMessage:
    def __init__(self, chat_id, user_id, first_name=None, username=None):
        self.chat = types.Chat(id=chat_id, type="private")
        self.from_user = types.User(id=user_id, is_bot=False, first_name=first_name or "User")
        if username:
            self.from_user.username = username
        self.text = None
        self.bot = None  # Add a bot attribute to avoid the error
        
    async def answer(self, text, **kwargs):
        # Log the response that would be sent
        logging.info(f"Would send message: {text}")
        return MockMessage(self.chat.id, self.from_user.id)
        
    async def delete(self):
        # Log the deletion that would happen
        logging.info(f"Would delete message")
        
    async def answer_video(self, video, **kwargs):
        # Log the video that would be sent
        logging.info(f"Would send video: {video.file}")
        print(json.dumps({"type": "video", "file": video.file, "chat_id": self.chat.id}))
        return MockMessage(self.chat.id, self.from_user.id)
        
    async def answer_audio(self, audio, **kwargs):
        # Log the audio that would be sent
        logging.info(f"Would send audio: {audio.file}")
        print(json.dumps({"type": "audio", "file": audio.file, "chat_id": self.chat.id}))
        return MockMessage(self.chat.id, self.from_user.id)


async def manual_download(url, quality, user_id):
    """Download media using yt-dlp directly"""
    logging.info(f"Manual download: {url}, quality={quality}")
    
    # Set the filename based on quality
    ext = 'm4a' if quality == 'audio' else 'mp4'
    filename = f"{user_id}.{ext}"
    
    # Create temp cookie file
    cookie_file = os.path.join(tempfile.gettempdir(), f'instagram_cookies_{user_id}.txt')
    try:
        with open(cookie_file, 'w') as f:
            f.write("""# Netscape HTTP Cookie File
.instagram.com	TRUE	/	TRUE	1735689600	ds_user_id	6837530647
.instagram.com	TRUE	/	TRUE	1735689600	sessionid	6837530647%3AJ0lPYYYYxxx%3A28%3AAYxxx""")
    except Exception as e:
        logging.error(f"Failed to create cookie file: {e}")
    
    # Ensure the file doesn't exist
    if os.path.exists(filename):
        try:
            os.remove(filename)
        except Exception as e:
            logging.error(f"Could not remove existing file: {e}")
            filename = f"{user_id}_{int(time.time())}.{ext}"
    
    # Set up yt-dlp options
    common_opts = {
        'outtmpl': filename,
        'cookiefile': cookie_file,
        'user_agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 105.0.0.11.118 (iPhone11,8; iOS 12_3_1; en_US; en-US; scale=2.00; 828x1792; 165586599)',
        'quiet': True,
        'no_warnings': True,
        'extract_flat': True,
    }
    
    if quality == 'audio':
        ydl_opts = {
            **common_opts,
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'm4a',
            }],
        }
    else:  # video
        ydl_opts = {
            **common_opts,
            'format': 'best[ext=mp4]/best',
        }
    
    # Use asyncio to run yt-dlp in a separate thread
    def download_with_ytdlp():
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                ydl.download([url])
            except Exception as e:
                logging.error(f"Download failed: {str(e)}")
                if "rate-limit" in str(e).lower() or "login required" in str(e).lower():
                    raise Exception("Instagram rate limit reached. Please try again later.")
                raise
        return filename
    
    try:
        # Run the download in a thread pool
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, download_with_ytdlp)
        
        # Verify the file exists
        if not os.path.exists(result):
            raise Exception(f"File {result} was not created")
        
        logging.info(f"Downloaded file successfully: {result}")
        return result
    finally:
        # Clean up temp cookie file
        try:
            if os.path.exists(cookie_file):
                os.remove(cookie_file)
        except Exception as e:
            logging.error(f"Failed to remove cookie file: {e}")


async def download_media(url, quality, chat_id, user_id):
    """Process a download request"""
    logging.info(f"Processing download request for {url}, quality={quality}, user_id={user_id}, chat_id={chat_id}")
    
    # Create a mock message object
    mock_message = MockMessage(chat_id, user_id)
    mock_message.text = url
    
    try:
        # Create a manual download function that bypasses the Downloader class
        filename = await manual_download(url, quality, user_id)
        
        if not filename:
            raise Exception("Failed to download media")
            
        # Get the absolute path
        abs_path = os.path.abspath(filename)
        logging.info(f"Downloaded file to: {abs_path}")
        
        # Report success
        print(json.dumps({"type": quality, "file": abs_path, "chat_id": chat_id}))
        return True
    except Exception as e:
        logging.error(f"Download failed: {str(e)}")
        print(json.dumps({"type": "error", "message": str(e), "chat_id": chat_id}))
        return False


async def main():
    """Main entry point for the service"""
    if len(sys.argv) < 4:
        logging.error("Usage: python downloader_service.py <url> <quality> <chat_id> <user_id>")
        return
        
    url = sys.argv[1]
    quality = sys.argv[2]
    chat_id = int(sys.argv[3])
    user_id = int(sys.argv[4])
    
    await download_media(url, quality, chat_id, user_id)


if __name__ == "__main__":
    asyncio.run(main())
