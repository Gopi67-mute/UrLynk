from fastapi import APIRouter

from app.api.v1 import auth, me, members, teams

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(me.router)
api_router.include_router(auth.router)
api_router.include_router(teams.router)
api_router.include_router(members.router)
