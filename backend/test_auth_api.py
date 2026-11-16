#!/usr/bin/env python3
"""
Integration Test Suite for ListenUp Authentication & API Endpoints
===================================================================
Covers:
  - GET /health: Health check responsiveness and JSON structure.
  - GET /api/auth/verify:
      - 401 Unauthorized when Bearer token header is missing.
      - 401 Unauthorized on malformed/invalid token signature.
      - 200 OK on developer demo token format ('demo-token-<uid>').
      - 200 OK on standard JWT decoding.
  - POST /api/recommendations/personalized: Preference ingestion and shelf generation.

Note:
  This suite requires a running local server at BASE_URL (default http://localhost:5001).
"""

from __future__ import annotations

import json
import sys
import unittest
import jwt
import requests

# Default endpoint URL for local backend testing
BASE_URL: str = "http://localhost:5001"


class TestBackendAuthAndAPI(unittest.TestCase):
    """Integration test case validating HTTP authentication responses and verification logic."""

    def test_health_check(self) -> None:
        """
        Health Check Test:
        Verifies that /health endpoint is operational and returns HTTP 200 with status: 'ok'.
        """
        res = requests.get(f"{BASE_URL}/health", timeout=3)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("status"), "ok")

    def test_unauthorized_access(self) -> None:
        """
        Security Test:
        Confirms that requests to protected /api/auth/verify without an Authorization header
        are rejected with HTTP 401 Unauthorized.
        """
        res = requests.get(f"{BASE_URL}/api/auth/verify", timeout=3)
        self.assertEqual(res.status_code, 401)
        self.assertIn("Missing Bearer token", res.json().get("error", ""))

    def test_invalid_token(self) -> None:
        """
        Security Test:
        Confirms that malformed, corrupted, or forged JWT tokens are rejected with HTTP 401.
        """
        headers = {"Authorization": "Bearer invalid.token.value"}
        res = requests.get(f"{BASE_URL}/api/auth/verify", headers=headers, timeout=3)
        self.assertEqual(res.status_code, 401)

    def test_valid_demo_session_token(self) -> None:
        """
        Developer Mode Test:
        Confirms that local development demo tokens ('demo-token-<uid>') are accepted
        in test environments without active Supabase cloud credentials.
        """
        headers = {"Authorization": "Bearer demo-token-test-user-999"}
        res = requests.get(f"{BASE_URL}/api/auth/verify", headers=headers, timeout=3)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("status"), "authenticated")
        self.assertEqual(data.get("user_id"), "test-user-999")
        self.assertEqual(data.get("email"), "test-user-999@listenup.local")

    def test_valid_jwt_payload_verification(self) -> None:
        """
        Standard JWT Verification Test:
        Encodes a mock JWT payload and verifies that the verification handler
        accurately decodes user identity claims (sub, email).
        """
        fake_jwt = jwt.encode(
            {"sub": "user-uuid-12345", "email": "test@example.com", "role": "authenticated"},
            "test_secret",
            algorithm="HS256"
        )
        headers = {"Authorization": f"Bearer {fake_jwt}"}
        res = requests.get(f"{BASE_URL}/api/auth/verify", headers=headers, timeout=3)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("user_id"), "user-uuid-12345")
        self.assertEqual(data.get("email"), "test@example.com")

    def test_personalized_recommendations_endpoint(self) -> None:
        """
        Personalized Recommendations Route Test:
        Validates that /api/recommendations/personalized accepts user preference payload
        and returns artistSections and tailoredMix components.
        """
        payload = {
            "artists": ["Arijit Singh", "Diljit Dosanjh"],
            "genres": ["bollywood", "lofi"],
            "languages": ["Hindi"],
            "moods": ["Chill"]
        }
        res = requests.post(f"{BASE_URL}/api/recommendations/personalized", json=payload, timeout=15)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("artistSections", data)
        self.assertIn("tailoredMix", data)
        self.assertTrue(isinstance(data["artistSections"], list))
        if data["artistSections"]:
            self.assertTrue("songs" in data["artistSections"][0])


if __name__ == "__main__":
    unittest.main()
