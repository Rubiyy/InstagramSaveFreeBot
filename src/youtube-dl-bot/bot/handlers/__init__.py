from aiogram import Router

from . import common, standart, downloader

router = Router()
router.include_router(common.router)
router.include_router(standart.router)

# Make sure the downloader is properly included
# This is just for explicit imports - the downloader is used by standart.py
