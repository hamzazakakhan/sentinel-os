from __future__ import annotations

from typing import Annotated

import jwt
import structlog
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.jwt_handler import (
    AuthUser,
    ClearanceLevel,
    UserRole,
    verify_access_token,
)

logger = structlog.get_logger(__name__)
_bearer_scheme = HTTPBearer(auto_error=False)

CLEARANCE_HIERARCHY = [
    ClearanceLevel.UNCLASSIFIED,
    ClearanceLevel.RESTRICTED,
    ClearanceLevel.CONFIDENTIAL,
    ClearanceLevel.SECRET,
    ClearanceLevel.TOP_SECRET,
]


async def get_current_user(
    request: Request,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)
    ] = None,
) -> AuthUser | None:
    if credentials is None:
        return None
    try:
        payload = verify_access_token(credentials.credentials)
        return AuthUser(
            id=payload.sub,
            username=payload.sub,
            role=payload.role,
            clearance=payload.clearance,
            org_id=payload.org_id,
            domains=payload.domains,
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError as e:
        logger.warning("invalid_token", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def require_auth(
    user: Annotated[AuthUser | None, Depends(get_current_user)],
) -> AuthUser:
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_role(*roles: UserRole):
    async def _check(user: Annotated[AuthUser, Depends(require_auth)]) -> AuthUser:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role {user.role.value} not authorized. Required: {[r.value for r in roles]}",
            )
        return user
    return _check


def require_clearance(minimum: ClearanceLevel):
    async def _check(user: Annotated[AuthUser, Depends(require_auth)]) -> AuthUser:
        user_level = CLEARANCE_HIERARCHY.index(user.clearance)
        required_level = CLEARANCE_HIERARCHY.index(minimum)
        if user_level < required_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Clearance {user.clearance.value} insufficient. Required: {minimum.value}",
            )
        return user
    return _check


def require_domain(*domains: str):
    async def _check(user: Annotated[AuthUser, Depends(require_auth)]) -> AuthUser:
        if not any(d in user.domains for d in domains):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Domain access denied. Required one of: {list(domains)}",
            )
        return user
    return _check
