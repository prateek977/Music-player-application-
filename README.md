# 🎵 ListenUp

A modern, personal, **local-first Android music player** built with **React 19**, **Capacitor 7**, and **Native Android Media3 (ExoPlayer)**. 

ListenUp operates entirely standalone on your Android device — requiring **no external Flask backend**, **no localhost server**, and zero server infrastructure for personal listening.

---

## 📱 Download Latest APK

Get the latest installable Android APKs directly from the [ListenUp v1.1.0 Release](https://github.com/prateek977/Music-player-application-/releases/tag/v1.1.0):

| Package | Type | Size | Download Link |
| :--- | :--- | :--- | :--- |
| **ListenUp Debug APK** | Developer / Direct Install | ~9.3 MB | [📥 Download ListenUp-debug.apk](https://github.com/prateek977/Music-player-application-/releases/download/v1.1.0/ListenUp-debug.apk) |
| **ListenUp Release APK** | Production (Unsigned) | ~6.9 MB | [📥 Download ListenUp-release-unsigned.apk](https://github.com/prateek977/Music-player-application-/releases/download/v1.1.0/ListenUp-release-unsigned.apk) |

> **Note**: Both APKs are also available inside the [`apks/`](./apks) directory of this repository.

---

## ✨ Features

- 🎧 **Genuine Native Background Playback**:
  - Powered by AndroidX **Media3 ExoPlayer** running in a native `MediaSessionService`.
  - Keeps playing smoothly when the app is minimized or the screen is locked.
  - Full system notification controls, lock-screen media controls, and Bluetooth headphone button support.
  - Proper audio focus management and headphone disconnection handling (`AUDIO_BECOMING_NOISY`).

- 🎶 **Multi-Source Audio Architecture**:
  - **YouTube InnerTube**: Full-length commercial songs and official music videos in foreground WebView mode.
  - **Audius Open Protocol**: High-fidelity 320 kbps MP3 full-length streaming with background audio capability.
  - **Promotional Previews**: Explicitly labeled `🎧 30s Preview (Sample)` for quick discovery with an instant `▶ Play Full Track` switch.

- 💾 **Local-First & Offline Storage**:
  - Built-in **Android Room Database** (`AppDatabase`) and **Jetpack DataStore** for personal playlists, favorites, and listening history.
  - No Python runtime or external backend required on Android.
  - Optional Supabase cloud synchronization for multi-device backup.

- 🎨 **Immersive Mobile Experience**:
  - React 19 + Tailwind CSS with edge-to-edge mobile UI design.
  - Interactive Now Playing screen with gesture-friendly queue drawer, true track duration, and clear audio source badges.

---

## 🏗️ Project Structure

```text
listenup/
├── apks/                                    # Ready-to-install Android APK binaries
│   ├── ListenUp-debug.apk                   # Debug APK (9.3 MB)
│   └── ListenUp-release-unsigned.apk        # Unsigned Release APK (6.9 MB)
│
├── listenup-web/                            # Frontend application & native Android bridge
│   ├── android/                             # Native Android Studio project (Capacitor)
│   │   ├── app/src/main/
│   │   │   ├── AndroidManifest.xml          # Permissions & MediaSessionService declarations
│   │   │   └── java/com/listenup/app/
│   │   │       ├── MainActivity.java        # Capacitor bridge & WebContents setup
│   │   │       ├── playback/
│   │   │       │   ├── ListenUpMediaService.java   # Native Media3 MediaSession foreground service
│   │   │       │   └── ListenUpMediaPlugin.java    # Thread-safe Capacitor playback plugin
│   │   │       ├── search/
│   │   │       │   └── ListenUpSearchPlugin.java   # Native YouTube InnerTube search plugin
│   │   │       └── data/local/
│   │   │           ├── AppDatabase.java            # Android Room SQLite database
│   │   │           ├── FavoritesDao.java           # Room DAO for favorite songs
│   │   │           ├── PlaylistsDao.java           # Room DAO for playlists
│   │   │           ├── HistoryDao.java             # Room DAO for play history
│   │   │           └── ListenUpStoragePlugin.java  # Capacitor storage plugin
│   │   └── app/src/test/java/com/listenup/  # Native JUnit threading & regression tests
│   │
│   ├── src/                                 # React 19 application source code
│   │   ├── components/
│   │   │   ├── auth/                        # User authentication & login modals
│   │   │   ├── player/                      # Media player components
│   │   │   │   ├── NowPlayingScreen.jsx     # Full-screen playback interface
│   │   │   │   ├── PlayerControls.jsx       # Play/Pause, Seek, Skip controls
│   │   │   │   ├── TrackMetadata.jsx        # Badges (YouTube, Preview, Background Stream)
│   │   │   │   └── QueueDrawer.jsx          # Interactive queue drawer
│   │   │   ├── profile/                     # Profile & user stats
│   │   │   └── onboarding/                  # Welcome & onboarding flows
│   │   ├── lib/
│   │   │   ├── nativeMediaBridge.js         # Bridge between React and ListenUpMediaPlugin
│   │   │   └── nativeSearchBridge.js        # Multi-source resolver (YouTube, Audius, Previews)
│   │   ├── App.jsx                          # Main application state & player coordination
│   │   ├── index.css                        # Tailwind CSS styles
│   │   └── main.jsx                         # React entrypoint
│   │
│   ├── capacitor.config.json                # Capacitor native configuration
│   ├── package.json                         # Node dependencies & build scripts
│   └── vite.config.js                       # Vite bundler configuration
│
├── supabase/                                # Supabase schema and migrations (optional cloud sync)
└── README.md                                # Project documentation
```

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend Framework** | React 19, Vite |
| **Styling** | Tailwind CSS, Lucide React Icons |
| **Mobile Runtime** | Capacitor 7 |
| **Native Audio Engine** | AndroidX Media3 ExoPlayer 1.5.1 |
| **Background Media Service**| AndroidX `MediaSessionService` |
| **Local Database** | Android Room Database (SQLite) + Jetpack DataStore |
| **Search & Metadata** | YouTube InnerTube (Native HTTP) + Audius Open API + iTunes Search API |
| **Cloud Authentication** | Supabase Auth (Optional) |

---

## 🚀 Getting Started & Local Development

### Prerequisites
- **Node.js**: `v20+` and `npm`
- **Java Development Kit**: JDK 21
- **Android SDK**: Android Studio with Android SDK API 34+ (Android 14/15)

### 1. Clone the Repository
```bash
git clone https://github.com/prateek977/Music-player-application-.git
cd Music-player-application-/listenup-web
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Web Preview
```bash
npm run dev
```

### 4. Run Test Suite
```bash
npm test
```

### 5. Check Linting & Formatting
```bash
npm run lint
```

---

## 📦 Building the Android APK

### 1. Build Frontend & Sync Capacitor
```bash
cd listenup-web
npm run build
npx cap sync android
```

### 2. Generate Debug APK
```bash
cd android
./gradlew assembleDebug
```
The output will be generated at:
```text
listenup-web/android/app/build/outputs/apk/debug/app-debug.apk
```

### 3. Generate Release APK (Unsigned)
```bash
./gradlew assembleRelease
```
The output will be generated at:
```text
listenup-web/android/app/build/outputs/apk/release/app-release-unsigned.apk
```

---

## 🧪 Running Native Tests

Unit regression tests verify thread safety, rapid play/pause toggles, and safe MediaController lifecycle operations:

```bash
cd listenup-web/android
./gradlew test
```

---

## 📄 License

This project is open-source. See the repository for details.
