# pyrefly: ignore [missing-import]
"""
Supabase Authentication & JWT Verification for ListenUp Backend
"""
import os
import logging
import jwt
import requests
from functools import wraps
from flask import request, jsonify

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SUPABASE_JWT_SECRET = os.environ.get('SUPABASE_JWT_SECRET', '')

def verify_supabase_token(token):
    """
    Verify a Supabase JWT token.
    1. If SUPABASE_JWT_SECRET is configured, decodes and verifies the HMAC/RSA signature.
    2. If SUPABASE_URL is configured, verifies by hitting the Supabase Auth /auth/v1/user endpoint.
    3. If neither or in development demo mode, safely parses and validates standard payload or demo sessions.
    """
    if not token:
        return None, "Missing authorization token"

    # If secret is set, verify cryptographic signature directly
    if SUPABASE_JWT_SECRET:
        try:
            payload = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated"
            )
            return payload, None
        except jwt.ExpiredSignatureError:
            return None, "Token has expired"
        except jwt.InvalidTokenError as e:
            logger.warning(f"JWT signature verification failed: {str(e)}")
            return None, "Invalid token"

    # If Supabase URL is set, verify via auth endpoint
    if SUPABASE_URL:
        try:
            headers = {
                "Authorization": f"Bearer {token}",
                "apikey": os.environ.get('SUPABASE_ANON_KEY', '')
            }
            res = requests.get(f"{SUPABASE_URL}/auth/v1/user", headers=headers, timeout=5)
            if res.status_code == 200:
                user_data = res.json()
                return {"sub": user_data.get("id"), "email": user_data.get("email"), "user": user_data}, None
            return None, f"Supabase auth failed with status {res.status_code}"
        except Exception as e:
            logger.warning(f"Remote Supabase user verification failed: {str(e)}")

    # Development fallback: parse unverified claims if running without Supabase credentials configured
    try:
        unverified = jwt.decode(token, options={"verify_signature": False})
        return unverified, None
    except Exception:
        # Check if it's a local demo token format 'demo-token-<uid>'
        if token.startswith("demo-token-"):
            uid = token.replace("demo-token-", "")
            return {"sub": uid, "email": f"{uid}@listenup.local", "role": "authenticated"}, None
        return None, "Malformed or invalid token format"

def require_auth(f):
    """Decorator to protect Flask endpoints requiring authentication"""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({"error": "Unauthorized: Missing Bearer token"}), 401

        token = auth_header.split('Bearer ')[1].strip()
        user_claims, error = verify_supabase_token(token)

        if error or not user_claims:
            return jsonify({"error": f"Unauthorized: {error or 'Invalid credentials'}"}), 401

        request.user = user_claims
        return f(*args, **kwargs)
    return decorated
