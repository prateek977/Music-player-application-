# pyrefly: ignore [missing-import]
"""
Supabase Authentication & JWT Verification for ListenUp Backend
================================================================
This module provides token verification and route protection utilities for
the ListenUp music streaming application backend.

It implements a robust three-tier authentication strategy:
  1. Cryptographic HMAC/RSA signature verification when SUPABASE_JWT_SECRET is set.
  2. Remote validation via Supabase Auth REST endpoint (/auth/v1/user) when SUPABASE_URL is configured.
  3. Development / Demo mode fallback to allow unverified payload inspection or local demo tokens
     ('demo-token-<uid>') without requiring live cloud credentials during development and testing.

Exported Functions & Decorators:
  - verify_supabase_token(token: str) -> tuple[dict | None, str | None]
  - require_auth(f: Callable) -> Callable
"""

from __future__ import annotations

import logging
import os
from functools import wraps
from typing import Any, Callable, Dict, Optional, Tuple

import jwt
import requests
from flask import jsonify, request

# Configure module-level logger
logger = logging.getLogger(__name__)

# Supabase configuration read from environment variables
# SUPABASE_URL: Base URL of the Supabase project instance (e.g., https://xyz.supabase.co)
SUPABASE_URL: str = os.environ.get('SUPABASE_URL', '').rstrip('/')

# SUPABASE_JWT_SECRET: Secret key used to cryptographically verify JWT signatures
SUPABASE_JWT_SECRET: str = os.environ.get('SUPABASE_JWT_SECRET', '')


def verify_supabase_token(token: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Verify and decode a Supabase JSON Web Token (JWT).

    This function attempts token verification across three tiers:
      1. Secret Verification: If SUPABASE_JWT_SECRET is set, the token's cryptographic
         signature is validated using the HS256 algorithm with 'authenticated' audience.
      2. Remote Auth Endpoint: If only SUPABASE_URL is configured, the token is validated
         by querying the Supabase Auth '/auth/v1/user' API directly.
      3. Development / Demo Fallback: If neither credential is set, or for local testing,
         the token is parsed without signature verification, and support for the
         'demo-token-<uid>' format is enabled.

    Args:
        token: The raw JWT string or demo token passed from the Authorization header.

    Returns:
        tuple: (claims_dict, error_message)
            - If valid: (payload_dict, None)
            - If invalid: (None, descriptive_error_string)
    """
    # Guard against missing, empty, or None token strings
    if not token:
        return None, "Missing authorization token"

    # ── Tier 1: Local cryptographic HMAC-SHA256 signature verification ───────
    if SUPABASE_JWT_SECRET:
        try:
            # Decode token ensuring the audience matches Supabase's 'authenticated' role
            payload = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated"
            )
            return payload, None
        except jwt.ExpiredSignatureError:
            # Token timestamp has passed the 'exp' claim boundary
            return None, "Token has expired"
        except jwt.InvalidTokenError as e:
            # Malformed token, signature mismatch, or audience mismatch
            logger.warning(f"JWT signature verification failed: {str(e)}")
            return None, "Invalid token"

    # ── Tier 2: Remote verification via Supabase REST API ─────────────────────
    if SUPABASE_URL:
        try:
            headers = {
                "Authorization": f"Bearer {token}",
                "apikey": os.environ.get('SUPABASE_ANON_KEY', '')
            }
            # Query the Supabase Auth user endpoint with a strict 5-second timeout
            res = requests.get(f"{SUPABASE_URL}/auth/v1/user", headers=headers, timeout=5)
            if res.status_code == 200:
                user_data = res.json()
                # Return standard claims dictionary matching Supabase JWT structure
                return {
                    "sub": user_data.get("id"),
                    "email": user_data.get("email"),
                    "user": user_data
                }, None
            return None, f"Supabase auth failed with status {res.status_code}"
        except Exception as e:
            logger.warning(f"Remote Supabase user verification failed: {str(e)}")

    # ── Tier 3: Development & local testing fallback ──────────────────────────
    # Allows developers to run and test endpoints without active cloud Supabase credentials
    try:
        # Decode the claims without verifying cryptographic signature
        unverified = jwt.decode(token, options={"verify_signature": False})
        return unverified, None
    except Exception:
        # Handle custom developer demo token format: 'demo-token-<uid>'
        if token.startswith("demo-token-"):
            uid = token.replace("demo-token-", "")
            return {
                "sub": uid,
                "email": f"{uid}@listenup.local",
                "role": "authenticated"
            }, None
        return None, "Malformed or invalid token format"


def require_auth(f: Callable) -> Callable:
    """
    Decorator to protect Flask endpoints requiring user authentication.

    Expects an incoming HTTP Authorization header with standard Bearer format:
        Authorization: Bearer <token>

    If the token is valid, the decoded user claims are attached to Flask's
    request context as `request.user` before invoking the wrapped route function.
    If missing or invalid, an HTTP 401 Unauthorized JSON response is returned.

    Usage:
        @app.route('/api/protected')
        @require_auth
        def protected_route():
            user_id = request.user.get('sub')
            return jsonify({"message": f"Hello {user_id}"})
    """
    @wraps(f)
    def decorated(*args: Any, **kwargs: Any) -> Any:
        auth_header = request.headers.get('Authorization', '')

        # Ensure the Authorization header conforms to the Bearer scheme
        if not auth_header.startswith('Bearer '):
            return jsonify({"error": "Unauthorized: Missing Bearer token"}), 401

        # Extract the token component after 'Bearer '
        token = auth_header.split('Bearer ')[1].strip()
        user_claims, error = verify_supabase_token(token)

        # Reject if verification failed or claims are empty
        if error or not user_claims:
            return jsonify({"error": f"Unauthorized: {error or 'Invalid credentials'}"}), 401

        # Attach claims to request context for downstream handlers
        request.user = user_claims
        return f(*args, **kwargs)

    return decorated
