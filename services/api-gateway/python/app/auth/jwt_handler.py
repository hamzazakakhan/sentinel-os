from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

import jwt
from pydantic import BaseModel

from app.config import get_settings


class UserRole(str, Enum):
    ADMIN = "admin"
    ANALYST = "analyst"
    OPERATOR = "operator"
    COMMANDER = "commander"
    AUDITOR = "auditor"
    VIEWER = "viewer"


class ClearanceLevel(str, Enum):
    UNCLASSIFIED = "UNCLASSIFIED"
    RESTRICTED = "RESTRICTED"
    CONFIDENTIAL = "CONFIDENTIAL"
    SECRET = "SECRET"
    TOP_SECRET = "TOP_SECRET"


class TokenPayload(BaseModel):
    sub: str
    role: UserRole
    clearance: ClearanceLevel
    org_id: str
    domains: list[str]
    exp: datetime
    iat: datetime
    jti: str
    token_type: str = "access"


class AuthUser(BaseModel):
    id: str
    username: str
    role: UserRole
    clearance: ClearanceLevel
    org_id: str
    domains: list[str]


def create_access_token(user: AuthUser) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.id,
        "username": user.username,
        "role": user.role.value,
        "clearance": user.clearance.value,
        "org_id": user.org_id,
        "domains": user.domains,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expiration_minutes),
        "jti": str(uuid.uuid4()),
        "token_type": "access",
    }
    return jwt.encode(
        payload,
        settings.jwt_secret.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )


def create_refresh_token(user: AuthUser) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.id,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + timedelta(days=settings.jwt_refresh_expiration_days),
        "token_type": "refresh",
    }
    return jwt.encode(
        payload,
        settings.jwt_secret.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )


def decode_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(
        token,
        settings.jwt_secret.get_secret_value(),
        algorithms=[settings.jwt_algorithm],
        options={"require": ["sub", "exp", "iat", "jti"]},
    )


def verify_access_token(token: str) -> TokenPayload:
    decoded = decode_token(token)
    if decoded.get("token_type") != "access":
        raise jwt.InvalidTokenError("Not an access token")
    return TokenPayload(**decoded)
