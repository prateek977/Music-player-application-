"""
Integration Tests for ListenUp Recommendation Endpoints
=======================================================
Tests Flask routes:
  - POST /api/listening-events
  - GET  /api/recommendations/next
  - GET  /api/recommendations/home
  - POST /api/recommendations/home
  - GET  /api/recommendations/similar/<song_id>
  - POST /api/recommendations/feedback
"""

import unittest
from unittest.mock import patch
from server import app


class TestRecommendationEndpoints(unittest.TestCase):

    def setUp(self):
        app.testing = True
        self.client = app.test_client()

    def test_listening_event_missing_song_id(self):
        """POST /api/listening-events without song_id returns 400."""
        resp = self.client.post("/api/listening-events", json={
            "event_type": "play_started"
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn("song_id is required", resp.get_json().get("error", ""))

    def test_listening_event_invalid_type(self):
        """POST /api/listening-events with unknown event_type returns 400."""
        resp = self.client.post("/api/listening-events", json={
            "song_id": "vid_123",
            "event_type": "invalid_magic_event"
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Invalid event_type", resp.get_json().get("error", ""))

    @patch("server.insert_listening_event")
    @patch("server.upsert_user_song_stats")
    def test_listening_event_valid_guest(self, mock_upsert, mock_insert):
        """POST /api/listening-events valid request returns 200 ok: True."""
        mock_insert.return_value = True
        mock_upsert.return_value = True

        resp = self.client.post("/api/listening-events", json={
            "song_id": "vid_abc123",
            "song_data": {
                "id": "vid_abc123",
                "title": "Kesariya",
                "artist": "Arijit Singh",
                "duration": 210
            },
            "event_type": "play_started",
            "listen_seconds": 0,
            "listen_fraction": 0.0
        })
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.get_json().get("ok"))
        mock_insert.assert_called_once()

    @patch("server.get_next_recommendations")
    def test_recommendations_next(self, mock_get_next):
        """GET /api/recommendations/next returns list of recommended songs."""
        mock_get_next.return_value = [
            {"id": "rec_1", "title": "Song 1", "artist": "Artist 1"},
            {"id": "rec_2", "title": "Song 2", "artist": "Artist 2"}
        ]

        resp = self.client.get("/api/recommendations/next?current_song_id=curr_1&genres=bollywood,pop&limit=2")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn("songs", data)
        self.assertEqual(len(data["songs"]), 2)
        self.assertEqual(data["songs"][0]["id"], "rec_1")

    @patch("server.get_home_sections")
    def test_recommendations_home(self, mock_home):
        """POST /api/recommendations/home returns structured sections."""
        mock_home.return_value = {
            "made_for_you": [{"id": "m1", "title": "Made 1"}],
            "because_you": [{"artist": "Arijit Singh", "songs": [{"id": "b1", "title": "Because 1"}]}],
            "discover_more": [{"id": "d1", "title": "Discover 1"}],
            "has_personalisation": True
        }

        resp = self.client.post("/api/recommendations/home", json={
            "genres": ["bollywood"],
            "artists": ["Arijit Singh"],
            "moods": ["chill"]
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn("made_for_you", data)
        self.assertIn("because_you", data)
        self.assertIn("discover_more", data)
        self.assertTrue(data["has_personalisation"])

    @patch("server.get_similar_songs")
    def test_recommendations_similar(self, mock_similar):
        """GET /api/recommendations/similar/<song_id> returns similar songs."""
        mock_similar.return_value = [
            {"id": "sim_1", "title": "Similar Track", "artist": "Arijit Singh"}
        ]

        resp = self.client.get("/api/recommendations/similar/test_id?artist=Arijit+Singh&title=Kesariya")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn("songs", data)
        self.assertEqual(len(data["songs"]), 1)

    @patch("server.insert_listening_event")
    @patch("server.upsert_user_song_stats")
    def test_recommendations_feedback(self, mock_upsert, mock_insert):
        """POST /api/recommendations/feedback records user feedback."""
        mock_insert.return_value = True
        mock_upsert.return_value = True

        resp = self.client.post("/api/recommendations/feedback", json={
            "song_id": "song_123",
            "action": "liked"
        })
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.get_json().get("ok"))
        mock_insert.assert_called_once()

    def test_recommendations_feedback_invalid_action(self):
        """POST /api/recommendations/feedback with bad action returns 400."""
        resp = self.client.post("/api/recommendations/feedback", json={
            "song_id": "song_123",
            "action": "not_an_action"
        })
        self.assertEqual(resp.status_code, 400)

    @patch("server.insert_listening_event")
    @patch("server.upsert_user_song_stats")
    def test_user_id_in_body_is_not_spoofed(self, mock_upsert, mock_insert):
        """User cannot spoof user_id by putting it in request body; must come from JWT."""
        mock_insert.return_value = True
        mock_upsert.return_value = True

        resp = self.client.post("/api/listening-events", json={
            "song_id": "vid_spoof",
            "song_data": {"id": "vid_spoof", "title": "Track", "artist": "Artist"},
            "event_type": "play_started",
            "user_id": "victim_user_123"  # spoof attempt!
        })
        self.assertEqual(resp.status_code, 200)
        # Because no Authorization Bearer token was provided, user_id must be None
        mock_insert.assert_called_once()
        self.assertIsNone(mock_insert.call_args[1].get("user_id"))
        mock_upsert.assert_not_called()

    @patch("server.insert_listening_event")
    @patch("server.upsert_user_song_stats")
    def test_authenticated_listening_event(self, mock_upsert, mock_insert):
        """Authenticated requests with valid Bearer token attribute event to verified user_id."""
        mock_insert.return_value = True
        mock_upsert.return_value = True

        headers = {"Authorization": "Bearer demo-token-verified-user-456"}
        resp = self.client.post(
            "/api/listening-events",
            headers=headers,
            json={
                "song_id": "vid_auth_1",
                "song_data": {"id": "vid_auth_1", "title": "Song", "artist": "Artist"},
                "event_type": "play_completed",
                "listen_seconds": 180,
                "listen_fraction": 1.0
            }
        )
        self.assertEqual(resp.status_code, 200)
        mock_insert.assert_called_once()
        self.assertEqual(mock_insert.call_args[1].get("user_id"), "verified-user-456")
        mock_upsert.assert_called_once()
        self.assertEqual(mock_upsert.call_args[1].get("user_id"), "verified-user-456")


if __name__ == "__main__":
    unittest.main()

