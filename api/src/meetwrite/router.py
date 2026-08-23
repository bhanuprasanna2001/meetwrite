"""Top-level API router assembly."""

from fastapi import APIRouter

from meetwrite.features.chat.router import router as chat_router
from meetwrite.features.dictionary.router import router as dictionary_router
from meetwrite.features.enhance.router import router as enhance_router
from meetwrite.features.entries.router import router as entries_router
from meetwrite.features.folders.router import router as folders_router
from meetwrite.features.health.router import router as health_router
from meetwrite.features.key.router import router as key_router
from meetwrite.features.settings.router import router as settings_router
from meetwrite.features.tags.router import router as tags_router
from meetwrite.features.templates.router import router as templates_router
from meetwrite.features.transcription.router import router as transcription_router
from meetwrite.features.user.router import router as user_router
from meetwrite.features.workflows.router import router as workflows_router

api_router = APIRouter()


api_router.include_router(health_router)
api_router.include_router(settings_router)
api_router.include_router(user_router)
api_router.include_router(entries_router)
api_router.include_router(folders_router)
api_router.include_router(tags_router)
api_router.include_router(key_router)
api_router.include_router(chat_router)
api_router.include_router(transcription_router)
api_router.include_router(enhance_router)
api_router.include_router(templates_router)
api_router.include_router(dictionary_router)
api_router.include_router(workflows_router)
