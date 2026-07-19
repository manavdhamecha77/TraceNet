from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
import os

from app.config import get_data_path

db_path = get_data_path("drishti.db")
# Ensure data directory exists
os.makedirs(os.path.dirname(db_path), exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{db_path}")

engine = create_engine(
    DATABASE_URL, 
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
