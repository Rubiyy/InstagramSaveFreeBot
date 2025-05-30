import asyncio
import logging
import os
import sys
from pathlib import Path

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.fsm.storage.memory import MemoryStorage
from dotenv import load_dotenv

from handlers import router


async def run_bot() -> None:
    # Try to load from main project .env file first
    main_env_path = Path(__file__).parent.parent.parent.parent / '.env'
    
    # First load the main .env if it exists
    if main_env_path.exists():
        load_dotenv(dotenv_path=main_env_path)
    
    # Then load local .env which might override values
    load_dotenv()
    
    logging.basicConfig(
        level=logging.INFO,
        format="[YouTubeDL-Bot] %(message)s - %(asctime)s",
        datefmt="%H:%M:%S",
    )
    
    # Use YOUTUBE_DL_BOT_TOKEN if available, otherwise fall back to TELEGRAM_BOT_TOKEN
    token = os.getenv("YOUTUBE_DL_BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("TOKEN")
    
    if not token:
        logging.error("No Telegram bot token found in environment variables!")
        sys.exit(1)
        
    logging.info("YouTube-DL Bot starting...")

    bot = Bot(
        token=token,
        default=DefaultBotProperties(parse_mode="HTML"),
    )
    storage = MemoryStorage()
    dp = Dispatcher(storage=storage)
    dp.include_router(router)

    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(run_bot())
