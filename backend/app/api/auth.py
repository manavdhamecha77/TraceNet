"""Login, session and user management endpoints (roles: operator, admin)."""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.middleware import auth_enabled, current_user, forget_user
from app.auth.security import ROLES, SESSION_COOKIE, hash_password, issue_token, verify_password
from app.config import get_settings
from app.db.models import UserAccount
from app.db.session import get_db

router = APIRouter(prefix="/api/v1/auth", tags=["Auth"])

MIN_PASSWORD_LENGTH = 8


class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    display_name: str = Field(min_length=1, max_length=100)
    role: str = "operator"
    password: str


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None


def _check_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=422, detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")


def _check_role(role: str) -> None:
    if role not in ROLES:
        raise HTTPException(status_code=422, detail=f"Role must be one of: {', '.join(ROLES)}.")


@router.get("/status")
def auth_status(db: Session = Depends(get_db)):
    """Public: whether login is required and whether any account exists yet."""
    return {"auth_enabled": auth_enabled(), "has_users": db.query(UserAccount).count() > 0}


@router.post("/login")
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    account = db.query(UserAccount).filter(UserAccount.username == payload.username.strip().lower()).first()
    if not account or not account.is_active or not verify_password(payload.password, account.password_hash):
        time.sleep(0.5)  # slow down password guessing
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    account.last_login_at = datetime.now(timezone.utc)
    db.commit()
    token = issue_token(account.id, account.role)
    response.set_cookie(
        SESSION_COOKIE, token, max_age=get_settings().auth_session_hours * 3600,
        httponly=True, samesite="lax", path="/",
    )
    return {"user": account.to_public(), "token": token}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"status": "logged_out"}


@router.get("/me")
def me(request: Request):
    user = current_user(request)
    if user:
        return {"auth_enabled": True, "user": user}
    # Auth disabled (development / tests): behave as a local admin
    return {"auth_enabled": False, "user": {"id": "local", "username": "local", "role": "admin",
                                             "display_name": "Local (login disabled)", "is_active": True}}


# ------------------------------------------------------------------ user management (Admin only, see policy)

@router.get("/users")
def list_users(db: Session = Depends(get_db)):
    return [u.to_public() for u in db.query(UserAccount).order_by(UserAccount.username).all()]


@router.post("/users", status_code=201)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    username = payload.username.strip().lower()
    _check_role(payload.role)
    _check_password(payload.password)
    if db.query(UserAccount).filter(UserAccount.username == username).first():
        raise HTTPException(status_code=409, detail=f"User '{username}' already exists.")
    account = UserAccount(id=str(uuid.uuid4()), username=username, display_name=payload.display_name.strip(),
                          role=payload.role, password_hash=hash_password(payload.password))
    db.add(account)
    db.commit()
    return account.to_public()


@router.patch("/users/{user_id}")
def update_user(user_id: str, payload: UserUpdate, db: Session = Depends(get_db)):
    account = db.query(UserAccount).filter(UserAccount.id == user_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="User not found.")
    demoting = payload.role is not None and payload.role != "admin" and account.role == "admin"
    disabling = payload.is_active is False and account.role == "admin"
    if (demoting or disabling) and db.query(UserAccount).filter(
        UserAccount.role == "admin", UserAccount.is_active == True, UserAccount.id != user_id  # noqa: E712
    ).count() == 0:
        raise HTTPException(status_code=409, detail="Cannot remove the last active Admin.")
    if payload.role is not None:
        _check_role(payload.role)
        account.role = payload.role
    if payload.display_name is not None:
        account.display_name = payload.display_name.strip()
    if payload.password is not None:
        _check_password(payload.password)
        account.password_hash = hash_password(payload.password)
    if payload.is_active is not None:
        account.is_active = payload.is_active
    db.commit()
    forget_user(user_id)
    return account.to_public()
