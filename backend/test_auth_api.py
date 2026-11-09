#!/usr/bin/env python3
"""
Test Suite for Backend Authentication, Token Verification & Recommendations
"""
import sys
import unittest
import requests
import json
import jwt

BASE_URL = "http://localhost:5001"

class TestBackendAuthAndAPI(unittest.TestCase):
    def test_health_check(self):
        """Test health endpoint responds ok"""
        res = requests.get(f"{BASE_URL}/health", timeout=3)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("status"), "ok")

    def test_unauthorized_access(self):
        """Test protected endpoint rejects request without Bearer token with 401"""
        res = requests.get(f"{BASE_URL}/api/auth/verify", timeout=3)
        self.assertEqual(res.status_code, 401)
        self.assertIn("Missing Bearer token", res.json().get("error", ""))

    def test_invalid_token(self):
        """Test protected endpoint rejects invalid malformed token with 401"""
        headers = {"Authorization": "Bearer invalid.token.value"}
        res = requests.get(f"{BASE_URL}/api/auth/verify", headers=headers, timeout=3)
        self.assertEqual(res.status_code, 401)

    def test_valid_demo_session_token(self):
        """Test protected endpoint accepts demo session token format in dev mode"""
        headers = {"Authorization": "Bearer demo-token-test-user-999"}
        res = requests.get(f"{BASE_URL}/api/auth/verify", headers=headers, timeout=3)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("status"), "authenticated")
        self.assertEqual(data.get("user_id"), "test-user-999")
        self.assertEqual(data.get("email"), "test-user-999@listenup.local")

    def test_valid_jwt_payload_verification(self):
        """Test standard JWT decoding format"""
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

    def test_personalized_recommendations_endpoint(self):
        """Test that /api/recommendations/personalized accepts user preferences"""
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
