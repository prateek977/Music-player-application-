"""
Unit Tests for ListenUp Recommendation Engine
==============================================
Covers:
  - Text normalization & token overlap
  - Genre and mood matching
  - Artist preference scoring
  - Listening history scoring & boost for liked songs
  - Skip penalty scaling and capping
  - Recency penalty calculations
  - Audio characteristics scoring (duration, view count)
  - Discovery scoring and artist diversity cap
  - Candidate exclusions (current song, exclude_ids)
  - Missing metadata resilience
  - Cold-start handling (no user history / no preferences)
  - Query generation logic
"""

import math
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock

import recommender
from recommender import (
    SCORE_WEIGHTS,
    RECENT_PLAY_WINDOW_SEC,
    RECENT_PLAY_PENALTY,
    MAX_SKIP_PENALTY,
    LIKED_SONG_BOOST,
    ARTIST_DIVERSITY_CAP,
    _normalise,
    _token_overlap,
    _genre_score_for_song,
    _mood_score_for_song,
    _artist_preference_score,
    _listening_history_score,
    _audio_characteristics_score,
    _discovery_score,
    _recency_multiplier,
    _build_query_from_prefs,
    score_candidate,
    get_next_recommendations,
    get_similar_songs,
    get_home_sections,
    _extract_artist_stats,
    _get_top_history_artists,
)


class TestRecommenderScoring(unittest.TestCase):

    def setUp(self):
        self.sample_song = {
            "id": "vid123",
            "title": "Kesariya - Brahmastra",
            "artist": "Arijit Singh",
            "duration": 210,
            "viewCount": 50000000,
        }

    def test_weights_sum_to_one(self):
        """Configuration check: all weights must sum to exactly 1.0."""
        total = sum(SCORE_WEIGHTS.values())
        self.assertAlmostEqual(total, 1.0, places=5)

    def test_normalise_and_token_overlap(self):
        """Verify string normalisation and token overlap."""
        self.assertEqual(_normalise("  Hello   WORLD!  "), "hello world!")
        self.assertEqual(_token_overlap("", "hello"), 0.0)
        self.assertEqual(_token_overlap("arijit singh", "arijit singh"), 1.0)
        self.assertGreater(_token_overlap("arijit singh", "arijit official"), 0.2)

    def test_genre_score(self):
        """Genre matching scores higher when keywords match song title or artist."""
        bollywood_song = {"title": "Tum Hi Ho Bollywood Hit", "artist": "Arijit Singh"}
        rock_song = {"title": "Sweet Child O Mine Rock", "artist": "Guns N Roses"}

        score_bolly = _genre_score_for_song(bollywood_song, ["bollywood"])
        score_rock = _genre_score_for_song(rock_song, ["bollywood"])

        self.assertGreater(score_bolly, score_rock)
        # Neutral score when no user genres
        self.assertEqual(_genre_score_for_song(bollywood_song, []), 0.5)

    def test_mood_score(self):
        """Mood matching aligns with mood keyword taxonomy."""
        chill_song = {"title": "Midnight Chill Lofi Beats", "artist": "ChilledCow"}
        party_song = {"title": "Ultimate Party Dance Anthem", "artist": "DJ Club"}

        score_chill = _mood_score_for_song(chill_song, ["chill"])
        score_party_on_chill = _mood_score_for_song(party_song, ["chill"])

        self.assertGreater(score_chill, score_party_on_chill)
        # Neutral score when no user moods
        self.assertEqual(_mood_score_for_song(chill_song, []), 0.5)

    def test_artist_preference_score(self):
        """User preferred artists get top score; non-preferred get neutral/lower."""
        match_song = {"artist": "Arijit Singh"}
        mismatch_song = {"artist": "The Rolling Stones"}

        fav_artists = ["Arijit Singh", "Diljit Dosanjh"]
        score_match = _artist_preference_score(match_song, fav_artists)
        score_mismatch = _artist_preference_score(mismatch_song, fav_artists)

        self.assertEqual(score_match, 1.0)
        self.assertLess(score_mismatch, score_match)
        # Neutral score when user has no artist preferences
        self.assertEqual(_artist_preference_score(match_song, []), 0.5)

    def test_listening_history_score_liked_boost(self):
        """Liked songs receive the configured boost."""
        song = {"id": "song_1"}
        stats_neutral = {}
        stats_liked = {"song_1": {"is_liked": True, "play_count": 0, "skip_count": 0}}

        score_neutral = _listening_history_score(song, stats_neutral)
        score_liked = _listening_history_score(song, stats_liked)

        self.assertEqual(score_neutral, 0.5)
        self.assertAlmostEqual(score_liked, 0.5 + LIKED_SONG_BOOST, places=4)

    def test_listening_history_skip_penalty(self):
        """Skipped songs get penalized, capped at MAX_SKIP_PENALTY."""
        song = {"id": "song_2"}
        stats_1_skip = {"song_2": {"is_liked": False, "play_count": 1, "skip_count": 1}}
        stats_10_skips = {"song_2": {"is_liked": False, "play_count": 1, "skip_count": 10}}

        score_1 = _listening_history_score(song, stats_1_skip)
        score_10 = _listening_history_score(song, stats_10_skips)

        self.assertLess(score_1, 0.6)
        self.assertLessEqual(score_10, 0.5 - MAX_SKIP_PENALTY + 0.1)
        self.assertGreaterEqual(score_10, 0.0)

    def test_audio_characteristics_score(self):
        """Ideal duration (2.5 - 6 min) and high views receive optimal scores."""
        ideal_song = {"duration": 210, "viewCount": 100000000}
        too_short_song = {"duration": 40, "viewCount": 100}

        score_ideal = _audio_characteristics_score(ideal_song)
        score_short = _audio_characteristics_score(too_short_song)

        self.assertGreater(score_ideal, score_short)

    def test_discovery_score_diversity(self):
        """Artist over-representation in a result set is heavily penalised."""
        song = {"artist": "Taylor Swift"}
        first_pick = _discovery_score(song, {"taylor swift": 0})
        second_pick = _discovery_score(song, {"taylor swift": 1})
        third_pick = _discovery_score(song, {"taylor swift": 2})

        self.assertEqual(first_pick, 1.0)
        self.assertEqual(second_pick, 0.5)
        self.assertEqual(third_pick, 0.1)

    def test_recency_penalty_calculation(self):
        """Songs played within RECENT_PLAY_WINDOW_SEC get penalized; older ones don't."""
        now = datetime.now(timezone.utc)
        just_played = (now - timedelta(minutes=10)).isoformat()
        long_ago = (now - timedelta(days=2)).isoformat()

        stats_recent = {"song_x": {"last_played_at": just_played}}
        stats_old = {"song_x": {"last_played_at": long_ago}}

        mul_recent = _recency_multiplier({"id": "song_x"}, stats_recent)
        mul_old = _recency_multiplier({"id": "song_x"}, stats_old)
        mul_none = _recency_multiplier({"id": "song_x"}, {})

        self.assertEqual(mul_recent, RECENT_PLAY_PENALTY)
        self.assertEqual(mul_old, 1.0)
        self.assertEqual(mul_none, 1.0)

    def test_score_candidate_exclusions(self):
        """Songs in excluded_ids or with missing id return None."""
        self.assertIsNone(score_candidate(
            {"id": ""},
            user_genres=[], user_moods=[], user_artists=[],
            stats_by_song={}, result_artist_counts={}, excluded_ids=set()
        ))

        self.assertIsNone(score_candidate(
            {"id": "skip_me"},
            user_genres=[], user_moods=[], user_artists=[],
            stats_by_song={}, result_artist_counts={}, excluded_ids={"skip_me"}
        ))

    def test_score_candidate_cold_start(self):
        """Cold-start user (no history, no preferences) still gets a valid score."""
        score = score_candidate(
            self.sample_song,
            user_genres=[],
            user_moods=[],
            user_artists=[],
            stats_by_song={},
            result_artist_counts={},
            excluded_ids=set()
        )
        self.assertIsNotNone(score)
        self.assertGreater(score, 0.0)
        self.assertLessEqual(score, 1.5)

    def test_missing_metadata_resilience(self):
        """Songs with empty or missing fields score without raising exceptions."""
        incomplete_song = {"id": "sparse_1"}  # no title, artist, duration, viewCount
        score = score_candidate(
            incomplete_song,
            user_genres=["bollywood"],
            user_moods=["chill"],
            user_artists=["Arijit Singh"],
            stats_by_song={},
            result_artist_counts={},
            excluded_ids=set()
        )
        self.assertIsNotNone(score)
        self.assertGreaterEqual(score, 0.0)


class TestRecommendationPipeline(unittest.TestCase):

    def setUp(self):
        self.mock_candidates = [
            {"id": "s1", "title": "Kesariya", "artist": "Arijit Singh", "duration": 210, "viewCount": 80000000},
            {"id": "s2", "title": "Lover", "artist": "Diljit Dosanjh", "duration": 190, "viewCount": 50000000},
            {"id": "s3", "title": "Apna Bana Le", "artist": "Arijit Singh", "duration": 240, "viewCount": 70000000},
            {"id": "s4", "title": "Hawayein", "artist": "Arijit Singh", "duration": 290, "viewCount": 60000000},
            {"id": "s5", "title": "Starboy", "artist": "The Weeknd", "duration": 230, "viewCount": 90000000},
            {"id": "s6", "title": "Blinding Lights", "artist": "The Weeknd", "duration": 200, "viewCount": 100000000},
        ]

    @patch("recommender._fetch_candidates_ytdlp")
    @patch("recommender.fetch_user_song_stats")
    def test_artist_diversity_cap_enforced(self, mock_stats, mock_fetch):
        """Ensure no single artist monopolises recommendations beyond ARTIST_DIVERSITY_CAP."""
        mock_stats.return_value = []
        mock_fetch.return_value = list(self.mock_candidates)

        recs = get_next_recommendations(
            user_id="user_test",
            user_genres=["bollywood"],
            user_moods=["romantic"],
            user_artists=["Arijit Singh"],
            current_song=None,
            exclude_ids=[],
            limit=5,
        )

        arijit_count = sum(1 for s in recs if "arijit" in s["artist"].lower())
        self.assertLessEqual(arijit_count, ARTIST_DIVERSITY_CAP)
        self.assertGreater(len(recs), 0)

    @patch("recommender._fetch_candidates_ytdlp")
    @patch("recommender.fetch_user_song_stats")
    def test_current_song_excluded(self, mock_stats, mock_fetch):
        """The currently playing track must never be recommended as next."""
        mock_stats.return_value = []
        mock_fetch.return_value = list(self.mock_candidates)

        current = {"id": "s1", "title": "Kesariya", "artist": "Arijit Singh"}
        recs = get_next_recommendations(
            user_id="user_test",
            user_genres=[],
            user_moods=[],
            user_artists=[],
            current_song=current,
            exclude_ids=[],
            limit=5,
        )

        rec_ids = [s["id"] for s in recs]
        self.assertNotIn("s1", rec_ids)

    @patch("recommender._fetch_candidates_ytdlp")
    def test_empty_candidates_returns_empty_list(self, mock_fetch):
        """When YouTube / candidate fetch returns nothing, returns empty list without error."""
        mock_fetch.return_value = []
        recs = get_next_recommendations(
            user_id=None,
            user_genres=[],
            user_moods=[],
            user_artists=[],
            current_song=None,
            exclude_ids=[],
            limit=5,
        )
        self.assertEqual(recs, [])

    def test_build_query_from_prefs(self):
        """Query covers user artists and genres."""
        q = _build_query_from_prefs(
            user_genres=["bollywood"],
            user_artists=["Arijit Singh", "Diljit Dosanjh"],
            user_moods=["chill"],
            current_song=None,
        )
        self.assertIn("Arijit Singh", q)
        self.assertIn("Diljit Dosanjh", q)

        # Cold start query
        q_cold = _build_query_from_prefs([], [], [], None)
        self.assertIn("trending", q_cold)

    def test_extract_artist_stats_and_top_artists(self):
        """Aggregate user history per artist and extract top affinity artists."""
        history = [
            {
                "song_id": "h1",
                "song_data": {"id": "h1", "title": "Kesariya", "artist": "Arijit Singh"},
                "play_count": 5, "skip_count": 0, "complete_count": 5, "total_listen_seconds": 1200, "is_liked": True
            },
            {
                "song_id": "h2",
                "song_data": {"id": "h2", "title": "Channa Mereya", "artist": "Arijit Singh"},
                "play_count": 3, "skip_count": 0, "complete_count": 3, "total_listen_seconds": 700, "is_liked": False
            },
            {
                "song_id": "h3",
                "song_data": {"id": "h3", "title": "Bad Song", "artist": "Skip Artist"},
                "play_count": 0, "skip_count": 5, "complete_count": 0, "total_listen_seconds": 15, "is_liked": False
            },
        ]
        stats = _extract_artist_stats(history)
        self.assertIn("arijit singh", stats)
        self.assertEqual(stats["arijit singh"]["plays"], 8)
        self.assertEqual(stats["arijit singh"]["completes"], 8)
        self.assertEqual(stats["arijit singh"]["likes"], 1)

        top_artists = _get_top_history_artists(stats, limit=2)
        self.assertIn("Arijit Singh", top_artists)
        self.assertNotIn("Skip Artist", top_artists)

    def test_artist_level_skip_soft_negative(self):
        """Artists with consistent skip pattern receive soft negative dampening."""
        artist_stats = {
            "skip artist": {"plays": 0, "skips": 4, "completes": 0, "likes": 0, "listen_sec": 20, "raw_name": "Skip Artist"},
            "arijit singh": {"plays": 10, "skips": 0, "completes": 10, "likes": 2, "listen_sec": 2000, "raw_name": "Arijit Singh"},
        }

        skip_song = {"id": "s_bad", "title": "New Track", "artist": "Skip Artist", "duration": 200, "viewCount": 500000}
        neutral_song = {"id": "s_neu", "title": "New Track", "artist": "Unknown Singer", "duration": 200, "viewCount": 500000}

        score_skip_artist = score_candidate(
            skip_song,
            user_genres=[], user_moods=[], user_artists=[],
            stats_by_song={}, result_artist_counts={}, excluded_ids=set(),
            artist_stats=artist_stats
        )
        score_skip_without_stats = score_candidate(
            skip_song,
            user_genres=[], user_moods=[], user_artists=[],
            stats_by_song={}, result_artist_counts={}, excluded_ids=set(),
            artist_stats=None
        )

        self.assertLess(score_skip_artist, score_skip_without_stats)
        # Difference should be bounded by soft dampening limit (0.15)
        self.assertAlmostEqual(score_skip_without_stats - score_skip_artist, 0.15, delta=0.01)

    @patch("recommender._fetch_candidates_ytdlp")
    @patch("recommender.fetch_user_song_stats")
    def test_history_candidate_seeding(self, mock_stats, mock_fetch):
        """Non-recent liked songs from history are seeded into recommendation candidates."""
        mock_stats.return_value = [
            {
                "song_id": "seed_liked_1",
                "song_data": {"id": "seed_liked_1", "title": "My Favorite Song", "artist": "Old Favorite", "duration": 220},
                "play_count": 10,
                "skip_count": 0,
                "complete_count": 10,
                "total_listen_seconds": 2200,
                "is_liked": True,
                "last_played_at": "2026-01-01T00:00:00+00:00",
            }
        ]
        # Return different songs from YouTube
        mock_fetch.return_value = [
            {"id": "yt_1", "title": "Trending 1", "artist": "Artist X", "duration": 200, "viewCount": 1000000},
        ]

        recs = get_next_recommendations(
            user_id="user_seeded",
            user_genres=[], user_moods=[], user_artists=[],
            current_song=None, exclude_ids=[], limit=5
        )
        rec_ids = [s["id"] for s in recs]
        self.assertIn("seed_liked_1", rec_ids)


if __name__ == "__main__":
    unittest.main()

