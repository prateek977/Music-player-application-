-- ListenUp Supabase PostgreSQL Schema & Migrations
-- Enables Supabase Authentication, Onboarding, Preferences, and User Data Layer

-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  onboarding_completed BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. Genres Catalog
CREATE TABLE IF NOT EXISTS public.genres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL
);

-- 3. Artists Catalog
CREATE TABLE IF NOT EXISTS public.artists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  image_url TEXT,
  external_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. Languages Catalog
CREATE TABLE IF NOT EXISTS public.languages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  code TEXT
);

-- 5. User Selected Genres (Composite PK)
CREATE TABLE IF NOT EXISTS public.user_genres (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  genre_id UUID REFERENCES public.genres(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (user_id, genre_id)
);

-- 6. User Favorite Artists (Composite PK)
CREATE TABLE IF NOT EXISTS public.user_favorite_artists (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  artist_id UUID REFERENCES public.artists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (user_id, artist_id)
);

-- 7. User Preferred Languages (Composite PK)
CREATE TABLE IF NOT EXISTS public.user_languages (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  language_id UUID REFERENCES public.languages(id) ON DELETE CASCADE,
  custom_language TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (user_id, language_id)
);

-- 8. User Listening Preferences
CREATE TABLE IF NOT EXISTS public.user_listening_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  preferred_moods TEXT[] DEFAULT '{}' NOT NULL,
  listening_activities TEXT[] DEFAULT '{}' NOT NULL,
  explicit_content_preference BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 9. User Favorites (Cloud Sync)
CREATE TABLE IF NOT EXISTS public.user_favorites (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL,
  song_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (user_id, song_id)
);

-- 10. User Playlists (Cloud Sync)
CREATE TABLE IF NOT EXISTS public.user_playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  songs JSONB DEFAULT '[]'::jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ─── Indexes for Performance ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_genres_user ON public.user_genres(user_id);
CREATE INDEX IF NOT EXISTS idx_user_artists_user ON public.user_favorite_artists(user_id);
CREATE INDEX IF NOT EXISTS idx_user_languages_user ON public.user_languages(user_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON public.user_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_playlists_user ON public.user_playlists(user_id);
CREATE INDEX IF NOT EXISTS idx_artists_name ON public.artists(name);

-- ─── Row-Level Security (RLS) ────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.languages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_favorite_artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_languages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_listening_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_playlists ENABLE ROW LEVEL SECURITY;

-- Profiles: Anyone can view (for room listener avatars), only owner can edit
DROP POLICY IF EXISTS "Profiles are readable by everyone" ON public.profiles;
CREATE POLICY "Profiles are readable by everyone"
  ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Catalogs: Readable by everyone
DROP POLICY IF EXISTS "Genres are readable by everyone" ON public.genres;
CREATE POLICY "Genres are readable by everyone"
  ON public.genres FOR SELECT USING (true);

DROP POLICY IF EXISTS "Artists are readable by everyone" ON public.artists;
CREATE POLICY "Artists are readable by everyone"
  ON public.artists FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can add artists" ON public.artists;
CREATE POLICY "Authenticated users can add artists"
  ON public.artists FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Languages are readable by everyone" ON public.languages;
CREATE POLICY "Languages are readable by everyone"
  ON public.languages FOR SELECT USING (true);

-- User Preferences: Owner full control
DROP POLICY IF EXISTS "Users manage own genres" ON public.user_genres;
CREATE POLICY "Users manage own genres"
  ON public.user_genres FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own favorite artists" ON public.user_favorite_artists;
CREATE POLICY "Users manage own favorite artists"
  ON public.user_favorite_artists FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own languages" ON public.user_languages;
CREATE POLICY "Users manage own languages"
  ON public.user_languages FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own listening preferences" ON public.user_listening_preferences;
CREATE POLICY "Users manage own listening preferences"
  ON public.user_listening_preferences FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own favorites" ON public.user_favorites;
CREATE POLICY "Users manage own favorites"
  ON public.user_favorites FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own playlists" ON public.user_playlists;
CREATE POLICY "Users manage own playlists"
  ON public.user_playlists FOR ALL USING (auth.uid() = user_id);

-- ─── Automatic Profile Creation Trigger on Sign-up ───────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url, onboarding_completed)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'avatar_url', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'),
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── Seed Initial Catalogs ───────────────────────────────────────────

-- Seed Genres
INSERT INTO public.genres (name, slug) VALUES
  ('Bollywood', 'bollywood'),
  ('Hip-Hop', 'hip-hop'),
  ('Rap', 'rap'),
  ('Pop', 'pop'),
  ('Rock', 'rock'),
  ('Electronic / EDM', 'electronic-edm'),
  ('Techno', 'techno'),
  ('House', 'house'),
  ('Lo-fi', 'lo-fi'),
  ('Indie', 'indie'),
  ('R&B / Soul', 'rnb-soul'),
  ('Classical', 'classical'),
  ('Jazz', 'jazz'),
  ('Acoustic', 'acoustic'),
  ('Metal', 'metal'),
  ('Devotional', 'devotional'),
  ('Instrumental', 'instrumental'),
  ('Punjabi music', 'punjabi')
ON CONFLICT (name) DO NOTHING;

-- Seed Languages
INSERT INTO public.languages (name, code) VALUES
  ('Hindi', 'hi'),
  ('English', 'en'),
  ('Punjabi', 'pa'),
  ('Bhojpuri', 'bho'),
  ('Tamil', 'ta'),
  ('Telugu', 'te'),
  ('Malayalam', 'ml'),
  ('Kannada', 'kn'),
  ('Bengali', 'bn'),
  ('Marathi', 'mr'),
  ('Gujarati', 'gu'),
  ('Urdu', 'ur'),
  ('Haryanvi', 'bgc'),
  ('Spanish', 'es'),
  ('Korean', 'ko'),
  ('Japanese', 'ja'),
  ('Other', 'other')
ON CONFLICT (name) DO NOTHING;

-- Seed Starter Artists Catalog (Curated with reliable verified images)
INSERT INTO public.artists (name, image_url, external_id) VALUES
  ('Arijit Singh', 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80', 'arijit-singh'),
  ('Shreya Ghoshal', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80', 'shreya-ghoshal'),
  ('Pritam', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&auto=format&fit=crop&q=80', 'pritam'),
  ('A. R. Rahman', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&auto=format&fit=crop&q=80', 'ar-rahman'),
  ('Diljit Dosanjh', 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=300&auto=format&fit=crop&q=80', 'diljit-dosanjh'),
  ('AP Dhillon', 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=300&auto=format&fit=crop&q=80', 'ap-dhillon'),
  ('Karan Aujla', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=300&auto=format&fit=crop&q=80', 'karan-aujla'),
  ('The Weeknd', 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=300&auto=format&fit=crop&q=80', 'the-weeknd'),
  ('Drake', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=300&auto=format&fit=crop&q=80', 'drake'),
  ('Taylor Swift', 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=300&auto=format&fit=crop&q=80', 'taylor-swift'),
  ('Ed Sheeran', 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=300&auto=format&fit=crop&q=80', 'ed-sheeran'),
  ('Alan Walker', 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=300&auto=format&fit=crop&q=80', 'alan-walker'),
  ('Billie Eilish', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=300&auto=format&fit=crop&q=80', 'billie-eilish'),
  ('Eminem', 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?w=300&auto=format&fit=crop&q=80', 'eminem'),
  ('Travis Scott', 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=300&auto=format&fit=crop&q=80', 'travis-scott'),
  ('Sonu Nigam', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=300&auto=format&fit=crop&q=80', 'sonu-nigam'),
  ('Sunidhi Chauhan', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=300&auto=format&fit=crop&q=80', 'sunidhi-chauhan'),
  ('Ayushmann Khurrana', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=300&auto=format&fit=crop&q=80', 'ayushmann-khurrana'),
  ('Jubin Nautiyal', 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=300&auto=format&fit=crop&q=80', 'jubin-nautiyal')
ON CONFLICT (external_id) DO NOTHING;

-- 11. Listening Events Table (for hybrid recommendation engine)
CREATE TABLE IF NOT EXISTS public.listening_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  listen_seconds NUMERIC DEFAULT 0,
  listen_fraction NUMERIC DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listening_events_user ON public.listening_events(user_id);
CREATE INDEX IF NOT EXISTS idx_listening_events_song ON public.listening_events(song_id);
ALTER TABLE public.listening_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert their own listening events" ON public.listening_events;
CREATE POLICY "Users can insert their own listening events"
  ON public.listening_events FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own listening events" ON public.listening_events;
CREATE POLICY "Users can view their own listening events"
  ON public.listening_events FOR SELECT USING (auth.uid() = user_id);
