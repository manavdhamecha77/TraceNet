"""Role-Based Access Control (RBAC) module for TraceNet API."""

from enum import Enum
from typing import List, Optional, Callable
from functools import wraps
from fastapi import Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from loguru import logger

from app.db.session import get_db


class UserRole(str, Enum):
    """System roles for access control."""
    ADMIN = "admin"  # Full system access
    OPERATOR = "operator"  # Can view alerts, acknowledge, manage webhooks
    ANALYST = "analyst"  # Can view data, run searches, view analytics
    VIEWER = "viewer"  # Read-only access
    GUEST = "guest"  # Limited read-only access


# Define role-based permissions
ROLE_PERMISSIONS = {
    UserRole.ADMIN: [
        "cameras:create", "cameras:read", "cameras:update", "cameras:delete",
        "models:create", "models:read", "models:update", "models:delete",
        "alerts:create", "alerts:read", "alerts:update", "alerts:delete",
        "webhooks:create", "webhooks:read", "webhooks:update", "webhooks:delete",
        "users:create", "users:read", "users:update", "users:delete",
        "audit:read", "audit:delete",
        "finetuning:start", "finetuning:stop",
        "system:config", "system:maintenance",
    ],
    UserRole.OPERATOR: [
        "cameras:read",
        "alerts:read", "alerts:update",
        "webhooks:read", "webhooks:update",
        "assault_detection:read",
        "frame_inspection:read",
        "search:read",
    ],
    UserRole.ANALYST: [
        "cameras:read",
        "alerts:read",
        "search:read",
        "analytics:read",
        "audit:read",
        "models:read",
        "finetuning:read",
    ],
    UserRole.VIEWER: [
        "cameras:read",
        "alerts:read",
        "search:read",
        "analytics:read",
    ],
    UserRole.GUEST: [
        "cameras:read",
        "alerts:read",
    ],
}


class User:
    """Represents an authenticated user with roles and permissions."""

    def __init__(self, user_id: str, username: str, role: UserRole):
        self.user_id = user_id
        self.username = username
        self.role = role
        self.permissions = ROLE_PERMISSIONS.get(role, [])

    def has_permission(self, permission: str) -> bool:
        """Check if user has a specific permission."""
        return permission in self.permissions

    def has_any_permission(self, permissions: List[str]) -> bool:
        """Check if user has any of the specified permissions."""
        return any(p in self.permissions for p in permissions)

    def has_all_permissions(self, permissions: List[str]) -> bool:
        """Check if user has all of the specified permissions."""
        return all(p in self.permissions for p in permissions)

    def can_access_resource(self, resource_type: str, action: str) -> bool:
        """Check if user can access a resource with a specific action."""
        permission = f"{resource_type}:{action}"
        return self.has_permission(permission)


# Mock user database - in production, this should use actual database
MOCK_USERS = {
    "admin_user": User("admin_user", "admin", UserRole.ADMIN),
    "operator_user": User("operator_user", "operator", UserRole.OPERATOR),
    "analyst_user": User("analyst_user", "analyst", UserRole.ANALYST),
    "viewer_user": User("viewer_user", "viewer", UserRole.VIEWER),
}


async def get_current_user(
    authorization: Optional[str] = Header(None),
) -> User:
    """
    Get the current authenticated user from the Authorization header.

    In production, this should validate JWT tokens.
    For now, we use a simple token-based lookup.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        scheme, credentials = authorization.split()
        if scheme.lower() != "bearer":
            raise ValueError("Invalid scheme")
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # For development: use token as user ID
    user = MOCK_USERS.get(credentials, None)
    if user is None:
        logger.warning(f"Invalid credentials attempt: {credentials}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    logger.info(f"User authenticated: {user.username} ({user.role})")
    return user


def require_permission(*permissions: str):
    """
    Decorator to require specific permissions.

    Usage:
        @router.get("/admin-only")
        @require_permission("system:config")
        async def admin_endpoint(current_user: User = Depends(get_current_user)):
            return {"message": "Admin access granted"}
    """

    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, current_user: User = None, **kwargs):
            if current_user is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User authentication required",
                )

            if not current_user.has_all_permissions(list(permissions)):
                logger.warning(
                    f"Permission denied for user {current_user.username}: "
                    f"required {permissions}"
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Permission denied. Required: {', '.join(permissions)}",
                )

            return await func(*args, current_user=current_user, **kwargs)

        return wrapper

    return decorator


def require_role(*roles: UserRole):
    """
    Decorator to require specific roles.

    Usage:
        @router.delete("/alerts/{alert_id}")
        @require_role(UserRole.ADMIN, UserRole.OPERATOR)
        async def delete_alert(alert_id: int, current_user: User = Depends(get_current_user)):
            return {"message": "Alert deleted"}
    """

    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, current_user: User = None, **kwargs):
            if current_user is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User authentication required",
                )

            if current_user.role not in roles:
                logger.warning(
                    f"Role-based access denied for user {current_user.username}: "
                    f"required one of {roles}"
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"This action requires one of: {', '.join(r.value for r in roles)}",
                )

            return await func(*args, current_user=current_user, **kwargs)

        return wrapper

    return decorator


def get_user_summary(user: User) -> dict:
    """Get a summary of user information."""
    return {
        "user_id": user.user_id,
        "username": user.username,
        "role": user.role.value,
        "permissions_count": len(user.permissions),
    }
