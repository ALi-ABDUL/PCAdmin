"""Shared app-level dependencies (app, router, db, logger).
Imported by server.py, helpers.py, and (via server.py) all endpoints.
Extracted from server.py during modular refactor (Feb 2026)."""
from fastapi import FastAPI, APIRouter
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path
import os
import logging

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Admin Dashboard API — Product Sourcing")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
