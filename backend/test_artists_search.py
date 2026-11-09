import unittest
from unittest.mock import patch, MagicMock
import json
import time

from server import (
    app,
    _clean_artist_image,
    _normalize_deezer_artist,
    _ARTIST_SEARCH_CACHE
)

class TestDeezerArtistDiscovery(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        _ARTIST_SEARCH_CACHE.clear()

    def test_clean_artist_image_filters_empty_deezer_hashes(self):
        # Empty hash
        blank = "https://cdn-images.dzcdn.net/images/artist//250x250-000000-80-0-0.jpg"
        self.assertIsNone(_clean_artist_image(blank))
        self.assertIsNone(_clean_artist_image(None))
        self.assertIsNone(_clean_artist_image(""))

        # Valid hash
        valid = "https://cdn-images.dzcdn.net/images/artist/ac5350cff290edd5b69fa584b8b1bd4f/250x250-000000-80-0-0.jpg"
        self.assertEqual(_clean_artist_image(valid), valid)

    def test_normalize_deezer_artist(self):
        raw = {
            "id": 3830821,
            "name": "Arijit Singh",
            "link": "https://www.deezer.com/artist/3830821",
            "picture_small": "https://cdn-images.dzcdn.net/images/artist/hash/56x56-000000-80-0-0.jpg",
            "picture_medium": "https://cdn-images.dzcdn.net/images/artist/hash/250x250-000000-80-0-0.jpg",
            "picture_big": "https://cdn-images.dzcdn.net/images/artist/hash/500x500-000000-80-0-0.jpg",
            "nb_fan": 234000,
            "nb_album": 12
        }
        norm = _normalize_deezer_artist(raw)
        self.assertEqual(norm["id"], "3830821")
        self.assertEqual(norm["name"], "Arijit Singh")
        self.assertEqual(norm["provider"], "deezer")
        self.assertEqual(norm["fanCount"], 234000)
        self.assertEqual(norm["imageMedium"], raw["picture_medium"])
        self.assertEqual(norm["imageLarge"], raw["picture_big"])
        self.assertEqual(norm["deezerUrl"], raw["link"])

    @patch("requests.get")
    def test_search_artists_endpoint_with_query(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": [
                {
                    "id": 3830821,
                    "name": "Arijit Singh",
                    "link": "https://www.deezer.com/artist/3830821",
                    "picture_medium": "https://cdn-images.dzcdn.net/images/artist/hash/250x250.jpg",
                    "nb_fan": 234000
                }
            ],
            "total": 100,
            "next": "https://api.deezer.com/search/artist?q=arijit&limit=1&index=1"
        }
        mock_get.return_value = mock_resp

        res = self.client.get('/api/artists/search?q=arijit&limit=1&index=0')
        self.assertEqual(res.status_code, 200)
        body = json.loads(res.data)

        self.assertEqual(body["total"], 100)
        self.assertTrue(body["hasMore"])
        self.assertEqual(body["nextIndex"], 1)
        self.assertEqual(len(body["artists"]), 1)
        self.assertEqual(body["artists"][0]["name"], "Arijit Singh")
        self.assertEqual(body["artists"][0]["id"], "3830821")
        self.assertEqual(body["artists"][0]["provider"], "deezer")

    @patch("requests.get")
    def test_search_artists_caching(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": [{"id": 12246, "name": "Taylor Swift", "nb_fan": 12000000}],
            "total": 1
        }
        mock_get.return_value = mock_resp

        # First request: fetches from external API
        res1 = self.client.get('/api/artists/search?q=taylor&limit=1')
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(mock_get.call_count, 1)

        # Second request: served from in-memory cache
        res2 = self.client.get('/api/artists/search?q=taylor&limit=1')
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(mock_get.call_count, 1)  # No extra network call

    @patch("requests.get")
    def test_search_artists_timeout_handling(self, mock_get):
        import requests
        mock_get.side_effect = requests.exceptions.Timeout("Connection timed out")

        res = self.client.get('/api/artists/search?q=timeout_test')
        self.assertEqual(res.status_code, 504)
        body = json.loads(res.data)
        self.assertIn("timed out", body["error"].lower())
        self.assertEqual(body["artists"], [])

    def test_search_artists_clamps_limit_and_index(self):
        with patch("requests.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {"data": [], "total": 0}
            mock_get.return_value = mock_resp

            # Negative limit and negative index
            self.client.get('/api/artists/search?q=test&limit=-5&index=-10')
            called_params = mock_get.call_args[1]["params"]
            self.assertEqual(called_params["limit"], 1)
            self.assertEqual(called_params["index"], 0)

            # Huge limit capped at 50
            self.client.get('/api/artists/search?q=test&limit=999')
            called_params = mock_get.call_args[1]["params"]
            self.assertEqual(called_params["limit"], 50)

if __name__ == "__main__":
    unittest.main()

