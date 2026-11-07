import React, { useState, useEffect, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { BackgroundMode } from '@anuradev/capacitor-background-mode';
import { Capacitor } from '@capacitor/core';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { useAuth } from './lib/authContext';
import AuthModal from './components/auth/AuthModal';
import ProfileSettingsModal from './components/profile/ProfileSettingsModal';
import OnboardingFlow from './components/onboarding/OnboardingFlow';
import GuestMigrationModal from './components/profile/GuestMigrationModal';
import { STARTER_ARTISTS } from './lib/starterCatalog';
import { NowPlayingScreen } from './components/player';
import { supabase, isSupabaseConfigured } from './lib/supabaseClient';

gsap.registerPlugin(ScrollTrigger);

// Canonical API Base URL fallback
const API_BASE_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

export default function App() {
  // Authentication & Personalization State
  const { user, profile, preferences, loading: authLoading, migrateGuestData } = useAuth();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState('signin');
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isGuestMigrationOpen, setIsGuestMigrationOpen] = useState(false);
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  const prevUserRef = useRef(null);

  // Navigation & Search State
  const [activeCategoryFilter, setActiveCategoryFilter] = useState('music'); // 'music' | 'podcasts' | 'audiobooks' | 'live'
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [activeHeroIndex, setActiveHeroIndex] = useState(0);

  // Time-based greeting helper
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning,';
    if (hour < 17) return 'Good Afternoon,';
    return 'Good Evening,';
  };
  const [activeTab, setActiveTab] = useState('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // Playback Queue State
  const [originalQueue, setOriginalQueue] = useState([]); // for restoring from shuffle
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  
  // Curated Categories State
  const [homeData, setHomeData] = useState({
    trending: [],
    sad: [],
    bollywood: [],
    hollywood: [],
    lofi: [],
    pop: [],
    romantic: [],
    party: []
  });
  const [homeLoading, setHomeLoading] = useState(true);

  // Suggested Songs State (Personalized recommendations based on client preferences)
  const [suggestedSongs, setSuggestedSongs] = useState(() => {
    try {
      const saved = localStorage.getItem('listenup_suggested_songs');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [suggestedLoading, setSuggestedLoading] = useState(false);
  const [suggestedMixTitle, setSuggestedMixTitle] = useState('Based on Your Taste');

  // Custom Playlists State
  const [playlists, setPlaylists] = useState(() => {
    const saved = localStorage.getItem('listenup_playlists');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { console.error(e); }
    }
    return [];
  });
  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [libraryFilter, setLibraryFilter] = useState('all'); // 'all' | 'playlists' | 'liked'
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [contextMenu, setContextMenu] = useState({ isOpen: false, song: null });
  const [isPlayerReady, setIsPlayerReady] = useState(false);

  // Playback State
  const [queue, setQueue] = useState([]);
  // Recently Played State
  const [recentlyPlayed, setRecentlyPlayed] = useState(() => {
    try {
      const saved = localStorage.getItem('listenup_recently_played');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [favorites, setFavorites] = useState(() => {
    try {
      const saved = localStorage.getItem('listenup_favorites');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Prompt user to sync guest favorites and playlists when logging in
  useEffect(() => {
    const prevId = prevUserRef.current?.id;
    const currentId = user?.id;
    if (!prevId && currentId) {
      const guestFavsCount = (favorites || []).length;
      const guestPlsCount = (playlists || []).length;
      if (guestFavsCount > 0 || guestPlsCount > 0) {
        setIsGuestMigrationOpen(true);
      }
    }
    prevUserRef.current = user;
  }, [user?.id]);

  // Two-way cloud sync: Fetch cloud favorites & playlists from Supabase when user logs in
  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured) return;

    let isMounted = true;
    const syncUserData = async () => {
      try {
        // 1. Fetch user favorites from cloud
        const { data: cloudFavs, error: favsErr } = await supabase
          .from('user_favorites')
          .select('song_data')
          .eq('user_id', user.id);

        if (!favsErr && cloudFavs && isMounted) {
          const loadedFavs = cloudFavs.map(r => r.song_data).filter(Boolean);
          if (loadedFavs.length > 0) {
            setFavorites(prev => {
              const existingIds = new Set(loadedFavs.map(s => s.id));
              const localUnsynced = prev.filter(s => !existingIds.has(s.id));
              const merged = [...loadedFavs, ...localUnsynced];
              localStorage.setItem('listenup_favorites', JSON.stringify(merged));
              return merged;
            });
          }
        }

        // 2. Fetch user playlists from cloud
        const { data: cloudPls, error: plsErr } = await supabase
          .from('user_playlists')
          .select('id, name, songs')
          .eq('user_id', user.id);

        if (!plsErr && cloudPls && isMounted) {
          const loadedPls = cloudPls.map(p => ({
            id: p.id,
            name: p.name,
            songs: Array.isArray(p.songs) ? p.songs : []
          }));
          if (loadedPls.length > 0) {
            setPlaylists(prev => {
              const existingIds = new Set(loadedPls.map(p => p.id));
              const localUnsynced = prev.filter(p => !existingIds.has(p.id));
              const merged = [...loadedPls, ...localUnsynced];
              localStorage.setItem('listenup_playlists', JSON.stringify(merged));
              return merged;
            });
          }
        }
      } catch (err) {
        console.warn('Could not sync favorites/playlists with cloud:', err);
      }
    };

    syncUserData();
    return () => { isMounted = false; };
  }, [user?.id]);

  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('listenup_volume');
    return saved ? parseInt(saved, 10) : 100;
  });

  // Player Stats
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [repeat, setRepeat] = useState('off'); // 'off' | 'all' | 'one'
  const [shuffle, setShuffle] = useState(false);
  // Music Rooms State
  const [activeRoom, setActiveRoom] = useState(null);
  const [roomParticipants, setRoomParticipants] = useState([]);
  const [roomActivity, setRoomActivity] = useState([]);
  const [roomCode, setRoomCode] = useState('');
  const [joinRoomCode, setJoinRoomCode] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [roomVisibility, setRoomVisibility] = useState('public');
  const [displayName, setDisplayName] = useState(() => {
    return localStorage.getItem('listenup_display_name') || 'Listener-' + Math.floor(Math.random() * 9000 + 1000);
  });
  const [publicRooms, setPublicRooms] = useState([]);
  const [roomError, setRoomError] = useState('');
  const [roomCreated, setRoomCreated] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [pendingSongRequests, setPendingSongRequests] = useState([]);
  const socketRef = useRef(null);

  const playerRef = useRef(null);
  const timerRef = useRef(null);
  const createPlaylistDialogRef = useRef(null);
  const isLoadingSongRef = useRef(false);
  const silentAudioRef = useRef(null);
  const stateRef = useRef({ currentSong, queue, repeat, isPlaying, shuffle, activeRoom, isHost });

  // GSAP Animation & UI Refs
  const mainContentRef = useRef(null);
  const heroRef = useRef(null);
  const categoriesContainerRef = useRef(null);
  const playerArtRef = useRef(null);
  const playerTitleRef = useRef(null);
  const searchInputRef = useRef(null);

  // Track Recently Played songs dynamically
  useEffect(() => {
    if (!currentSong || !currentSong.id) return;
    setRecentlyPlayed(prev => {
      const filtered = prev.filter(s => s.id !== currentSong.id);
      const updated = [currentSong, ...filtered].slice(0, 25);
      try {
        localStorage.setItem('listenup_recently_played', JSON.stringify(updated));
      } catch (e) {
        console.error("Error saving recently played:", e);
      }
      return updated;
    });
  }, [currentSong?.id]);

  // Sync state ref for YouTube event listeners
  useEffect(() => {
    stateRef.current = { currentSong, queue, repeat, isPlaying, shuffle, activeRoom, isHost };
  }, [currentSong, queue, repeat, isPlaying, shuffle, activeRoom, isHost]);

  // Load favorites, volume, playlists and fetch home categories on mount
  useEffect(() => {
    // Initial fetch for playlists/queue happens via Google Login or localStorage
    const savedPlaylists = localStorage.getItem('listenup_playlists');
    if (savedPlaylists) {
      try { setPlaylists(JSON.parse(savedPlaylists)); } catch (e) { console.error(e); }
    }
    const savedQueue = localStorage.getItem('listenup_queue');
    if (savedQueue) {
      try { setQueue(JSON.parse(savedQueue)); } catch (e) { console.error(e); }
    }
    
    // Fetch home screen browse data
    fetchHomeData();

    // Load YouTube Iframe API
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      
      window.onYouTubeIframeAPIReady = () => {
        initPlayer();
      };
    } else {
      initPlayer();
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Handle Safari closedby backdrop fallback for `<dialog>`
  useEffect(() => {
    const dialog = createPlaylistDialogRef.current;
    if (!dialog) return;

    const handleBackdropClick = (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isDialogContent = (
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width
      );
      if (!isDialogContent) {
        dialog.close();
        setNewPlaylistName('');
      }
    };

    dialog.addEventListener('click', handleBackdropClick);
    return () => dialog.removeEventListener('click', handleBackdropClick);
  }, []);

  // Persist playlists and queue to local
  useEffect(() => {
    localStorage.setItem('listenup_playlists', JSON.stringify(playlists));
    localStorage.setItem('listenup_queue', JSON.stringify(queue));
  }, [playlists, queue]);
  // Socket.IO connection for Music Rooms
  useEffect(() => {
    const backendUrl = API_BASE_URL || window.location.origin;
    const socket = io(backendUrl, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connected', (data) => {
      console.log('Socket connected:', data.sid);
    });

    socket.on('room_created', (room) => {
      setActiveRoom(room);
      setRoomCode(room.code);
      setRoomParticipants(room.participants || []);
      setIsHost(true);
      setRoomCreated(true);
      setRoomError('');
    });

    socket.on('room_joined', (room) => {
      setActiveRoom(room);
      setRoomCode(room.code);
      setRoomParticipants(room.participants || []);
      setIsHost(false);
      setRoomCreated(false);
      setRoomError('');
      // If host is playing a song, sync to it
      if (room.currentSong) {
        setCurrentSong(room.currentSong);
        if (room.isPlaying && playerRef.current && playerRef.current.loadVideoById) {
          playerRef.current.loadVideoById(room.currentSong.id, room.currentTime || 0);
          setIsPlaying(true);
        }
      }
    });

    socket.on('room_update', (room) => {
      setActiveRoom(room);
      setRoomParticipants(room.participants || []);
    });

    socket.on('room_left', () => {
      setActiveRoom(null);
      setRoomCode('');
      setRoomParticipants([]);
      setRoomActivity([]);
      setIsHost(false);
      setRoomCreated(false);
    });

    socket.on('room_error', (data) => {
      setRoomError(data.message);
    });

    socket.on('activity', (data) => {
      setRoomActivity(prev => [...prev.slice(-49), data]);
    });

    socket.on('playback_update', (data) => {
      // Listeners receive playback state from host
      if (data.currentSong) {
        const currentId = stateRef.current.currentSong?.id;
        if (currentId !== data.currentSong.id) {
          // New song — load it at the host's current time
          setCurrentSong(data.currentSong);
          if (playerRef.current) {
            isLoadingSongRef.current = true;
            if (data.isPlaying) {
              playerRef.current.loadVideoById?.(data.currentSong.id, data.currentTime || 0);
            } else {
              playerRef.current.cueVideoById?.(data.currentSong.id, data.currentTime || 0);
            }
          }
        } else if (Math.abs((playerRef.current?.getCurrentTime?.() || 0) - (data.currentTime || 0)) > 4) {
          // Same song but time drifted — seek to sync
          playerRef.current?.seekTo?.(data.currentTime, true);
        }
      }
      // Force play/pause state to match the host
      if (data.isPlaying) {
        playerRef.current?.playVideo?.();
        setIsPlaying(true);
      } else {
        playerRef.current?.pauseVideo?.();
        setIsPlaying(false);
      }
    });

    socket.on('load_song', (data) => {
      if (data.song) {
        setCurrentSong(data.song);
        setIsBuffering(true);
        if (playerRef.current) {
          playerRef.current.cueVideoById?.(data.song.id);
        }
      }
    });

    socket.on('start_playback', (data) => {
      if (playerRef.current) {
        playerRef.current.playVideo?.();
        if (data.currentTime !== undefined) {
          playerRef.current.seekTo?.(data.currentTime, true);
        }
        setIsPlaying(true);
        setIsBuffering(false);
      }
    });

    // Host receives song requests from listeners — show as notification
    socket.on('song_requested', (data) => {
      if (data.song) {
        setPendingSongRequests(prev => [...prev, {
          id: Date.now() + Math.random(),
          song: data.song,
          requestedBy: data.requestedBy || 'Someone'
        }]);
      }
    });

    // Host receives play/pause requests from listeners
    socket.on('playback_requested', (data) => {
      setIsPlaying(data.isPlaying);
    });

    return () => socket.disconnect();
  }, []);

  // Sync playback to room when host changes song or play state
  useEffect(() => {
    if (isHost && activeRoom && socketRef.current) {
      socketRef.current.emit('sync_playback', {
        currentSong,
        isPlaying,
        currentTime: playerRef.current?.getCurrentTime?.() || 0
      });
    }
  }, [currentSong, isPlaying, isHost, activeRoom]);

  // Periodic time sync from host (every 3 seconds) to keep listeners in lockstep
  useEffect(() => {
    if (!isHost || !activeRoom || !socketRef.current) return;
    const interval = setInterval(() => {
      const state = stateRef.current;
      if (state.currentSong && state.isPlaying) {
        socketRef.current?.emit('sync_playback', {
          currentSong: state.currentSong,
          isPlaying: state.isPlaying,
          currentTime: playerRef.current?.getCurrentTime?.() || 0
        });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [isHost, activeRoom]);

  // Fetch public rooms when entering the rooms tab
  useEffect(() => {
    if (activeTab === 'rooms' && !activeRoom) {
      fetch(`${API_BASE_URL}/api/rooms`).then(r => r.json()).then(data => setPublicRooms(data)).catch(() => {});
    }
  }, [activeTab, activeRoom]);

  // Save display name
  useEffect(() => {
    localStorage.setItem('listenup_display_name', displayName);
  }, [displayName]);

  // Auto-join room from URL (e.g. /room/MZK-4839)
  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/room\/([A-Z0-9-]+)$/i);
    if (match && socketRef.current) {
      const code = match[1].toUpperCase();
      setActiveTab('rooms');
      setJoinRoomCode(code);
      // Wait a moment for the socket to be fully connected
      const timer = setTimeout(() => {
        socketRef.current?.emit('join_room_request', { roomCode: code, displayName });
      }, 1000);
      // Clean up URL
      window.history.replaceState({}, '', '/');
      return () => clearTimeout(timer);
    }
  }, []);

  const handleCreateRoom = () => {
    if (!newRoomName.trim()) return;
    socketRef.current?.emit('create_room', {
      roomName: newRoomName.trim(),
      visibility: roomVisibility,
      displayName
    });
  };

  const handleJoinRoom = () => {
    if (!joinRoomCode.trim()) return;
    socketRef.current?.emit('join_room_request', {
      roomCode: joinRoomCode.trim().toUpperCase(),
      displayName
    });
  };

  const handleLeaveRoom = () => {
    socketRef.current?.emit('leave_room_request', { roomCode });
  };

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    if (type === 'code') { setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2000); }
    if (type === 'link') { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); }
  };

  const handleAcceptSongRequest = (request) => {
    setCurrentSong(request.song);
    setQueue(prev => {
      if (prev.some(s => s.id === request.song.id)) return prev;
      return [...prev, request.song];
    });
    setPendingSongRequests(prev => prev.filter(r => r.id !== request.id));
  };

  const handleDeclineSongRequest = (request) => {
    setPendingSongRequests(prev => prev.filter(r => r.id !== request.id));
  };


  async function fetchHomeData() {
    setHomeLoading(true);
    const categories = ['trending', 'sad', 'bollywood', 'hollywood', 'lofi', 'pop', 'romantic', 'party'];
    try {
      const promises = categories.map(async (cat) => {
        const res = await fetch(`${API_BASE_URL}/api/browse?category=${cat}`);
        if (!res.ok) throw new Error(`Failed to fetch ${cat}`);
        const data = await res.json();
        return { cat, data };
      });
      const results = await Promise.allSettled(promises);
      const newData = {
        trending: [],
        sad: [],
        bollywood: [],
        hollywood: [],
        lofi: [],
        pop: [],
        romantic: [],
        party: []
      };
      results.forEach((res) => {
        if (res.status === 'fulfilled') {
          newData[res.value.cat] = Array.isArray(res.value.data) ? res.value.data : [];
        }
      });
      setHomeData(newData);
    } catch (err) {
      console.error("Error loading home categories:", err);
    } finally {
      setHomeLoading(false);
    }
  };

  // Fetch Personalized Song Suggestions based on user preferences
  const fetchSuggestedSongs = async () => {
    setSuggestedLoading(true);
    try {
      const activeArtists = (preferences?.artists || []).map(a => typeof a === 'string' ? a : a.name).filter(Boolean);
      const activeGenres = preferences?.genres || [];
      const activeLangs = preferences?.languages || [];
      const activeMoods = preferences?.moods || [];

      // Use saved preferences or default starter taste for high quality recommendations
      const requestArtists = activeArtists.length > 0 ? activeArtists : ['Arijit Singh', 'Diljit Dosanjh', 'The Weeknd'];
      const requestGenres = activeGenres.length > 0 ? activeGenres : ['bollywood', 'pop'];
      const requestLangs = activeLangs.length > 0 ? activeLangs : ['Hindi', 'English'];
      const requestMoods = activeMoods.length > 0 ? activeMoods : ['chill'];

      const response = await fetch(`${API_BASE_URL}/api/recommendations/personalized`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artists: requestArtists,
          genres: requestGenres,
          languages: requestLangs,
          moods: requestMoods
        })
      });

      if (response.ok) {
        const data = await response.json();
        const collectedSongs = [];
        const seenIds = new Set();

        if (data.tailoredMix?.songs && Array.isArray(data.tailoredMix.songs)) {
          if (data.tailoredMix.title) setSuggestedMixTitle(data.tailoredMix.title);
          for (const s of data.tailoredMix.songs) {
            if (s && s.id && !seenIds.has(s.id)) {
              seenIds.add(s.id);
              collectedSongs.push(s);
            }
          }
        }

        if (Array.isArray(data.artistSections)) {
          for (const sec of data.artistSections) {
            for (const s of (sec.songs || [])) {
              if (s && s.id && !seenIds.has(s.id)) {
                seenIds.add(s.id);
                collectedSongs.push(s);
              }
            }
          }
        }

        if (collectedSongs.length > 0) {
          setSuggestedSongs(collectedSongs);
          try {
            localStorage.setItem('listenup_suggested_songs', JSON.stringify(collectedSongs));
          } catch (e) {}
          setSuggestedLoading(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Personalized suggestions fetch warning:', err);
    }

    // Fallback gracefully to catalog items if backend endpoint is unavailable
    const fallbackList = [
      ...(homeData.bollywood || []),
      ...(homeData.trending || []),
      ...(homeData.pop || []),
      ...(homeData.romantic || [])
    ];
    const uniqueFallback = [];
    const seen = new Set();
    for (const song of fallbackList) {
      if (song && song.id && !seen.has(song.id)) {
        seen.add(song.id);
        uniqueFallback.push(song);
      }
    }
    if (uniqueFallback.length > 0) {
      setSuggestedSongs(uniqueFallback.slice(0, 16));
    }
    setSuggestedLoading(false);
  };

  // Re-fetch suggested songs whenever user preferences update
  useEffect(() => {
    fetchSuggestedSongs();
  }, [
    preferences?.artists?.length, 
    preferences?.genres?.length, 
    preferences?.languages?.length, 
    preferences?.moods?.length,
    user?.id
  ]);

  function initPlayer() {
    playerRef.current = new window.YT.Player('yt-player-iframe', {
      height: '100%',
      width: '100%',
      videoId: '',
      playerVars: {
        playsinline: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        rel: 0,
        showinfo: 0,
        iv_load_policy: 3
      },
      events: {
        onReady: (event) => {
          event.target.setVolume(volume);
          setIsPlayerReady(true);
        },
        onStateChange: (event) => {
          handlePlayerStateChange(event.data);
        }
      }
    });
  };

  const handlePlayerStateChange = (state) => {
    // For non-host listeners in a room, only update the time display
    // Play/pause state is controlled entirely by the host sync
    const inRoomAsListener = stateRef.current.activeRoom && !stateRef.current.isHost;

    if (state === 1) { // PLAYING
      isLoadingSongRef.current = false;
      setIsBuffering(false);
      if (!inRoomAsListener) {
        setIsPlaying(true);
      }
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        if (playerRef.current && playerRef.current.getCurrentTime) {
          setCurrentTime(playerRef.current.getCurrentTime());
          setDuration(playerRef.current.getDuration() || 0);
        }
      }, 500);
    } else if (state === 2) { // PAUSED
      // Ignore transient PAUSED events fired by YouTube while loading a new video
      if (isLoadingSongRef.current) return;
      // If listener in room, don't set pause — host controls playback
      if (inRoomAsListener) return;
      setIsPlaying(false);
      if (timerRef.current) clearInterval(timerRef.current);
    } else if (state === 0) { // ENDED
      isLoadingSongRef.current = false;
      // If listener in room, let host handle next song
      if (inRoomAsListener) return;
      setIsPlaying(false);
      if (timerRef.current) clearInterval(timerRef.current);
      
      const { repeat: currentRepeat } = stateRef.current;
      if (currentRepeat === 'one') {
        playerRef.current.seekTo(0);
        playerRef.current.playVideo();
        setIsPlaying(true);
      } else {
        playNext();
      }
    } else if (state === 3) { // BUFFERING
      setIsBuffering(true);
    } else if (state === 5) { // CUED
      if (stateRef.current.activeRoom && socketRef.current) {
        socketRef.current.emit('player_ready');
      }
    }
  };

  // Playback control effects
  useEffect(() => {
    const inRoomAsListener = activeRoom && !isHost;
    // If listener in room, do NOT auto-play here — playback_update socket event handles this
    if (inRoomAsListener) return;

    if (currentSong && isPlayerReady && playerRef.current && playerRef.current.loadVideoById) {
      isLoadingSongRef.current = true;
      setIsBuffering(true);
      setCurrentTime(0);
      setDuration(0);
      
      if (isHost && activeRoom) {
        // Host in a room: tell server to orchestrate playback sync
        if (socketRef.current) {
          socketRef.current.emit('prepare_song', { song: currentSong });
        }
      } else {
        // Normal solo playback
        playerRef.current.loadVideoById(currentSong.id);
        setIsPlaying(true);
      }
      addToQueueSilent(currentSong);
    }
  }, [currentSong, isPlayerReady, activeRoom, isHost]);

  useEffect(() => {
    if (playerRef.current && playerRef.current.playVideo && playerRef.current.pauseVideo) {
      if (isPlaying) {
        playerRef.current.playVideo();
        silentAudioRef.current?.play().catch(e => console.log('Silent audio play failed', e));
      } else {
        playerRef.current.pauseVideo();
        silentAudioRef.current?.pause();
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    if (playerRef.current && playerRef.current.setVolume) {
      playerRef.current.setVolume(isMuted ? 0 : volume);
      localStorage.setItem('listenup_volume', volume.toString());
    }
  }, [volume, isMuted]);

  // --- Media Session API Integration ---
  useEffect(() => {
    if ('mediaSession' in navigator && currentSong) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.title,
        artist: currentSong.artist || 'Unknown Artist',
        artwork: [
          { src: currentSong.thumbnailUrl, sizes: '512x512', type: 'image/jpeg' }
        ]
      });

      try {
        navigator.mediaSession.setActionHandler('play', () => {
          setIsPlaying(true);
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          setIsPlaying(false);
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          playPrevious();
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          playNext();
        });
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (playerRef.current && playerRef.current.seekTo) {
            playerRef.current.seekTo(details.seekTime, true);
          }
        });
      } catch (error) {
        console.log("Media session actions not supported", error);
      }
    }
  }, [currentSong]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying]);
  // --- Android Background Fixes ---
  useEffect(() => {
    // 1. Audio Priming (Unlocking)
    const unlockAudio = () => {
      if (silentAudioRef.current) {
        silentAudioRef.current.play().then(() => {
          silentAudioRef.current.pause();
          document.removeEventListener('click', unlockAudio);
          document.removeEventListener('touchstart', unlockAudio);
        }).catch(() => {});
      }
    };
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);

    // 2. Visibility Change Override
    const handleVisibilityChange = () => {
      if (document.hidden && stateRef.current.isPlaying) {
        // Force YouTube to keep playing or play again immediately if Android paused it
        if (playerRef.current && playerRef.current.playVideo) {
          playerRef.current.playVideo();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
  // --------------------------------

  // Queue Operations
  const playSong = (song) => {
    // If in a room and NOT the host, send request to host instead of playing locally
    const { activeRoom: currentRoom, isHost: currentIsHost } = stateRef.current;
    if (currentRoom && !currentIsHost && socketRef.current) {
      socketRef.current.emit('request_song', { song, displayName });
      return;
    }
    setCurrentSong(song);
    setIsBuffering(true);
    
    const index = queue.findIndex(s => s.id === song.id);
    if (index === -1) {
      const currentIdx = queue.findIndex(s => s.id === currentSong?.id);
      const newQueue = [...queue];
      if (currentIdx === -1) {
        newQueue.push(song);
      } else {
        newQueue.splice(currentIdx + 1, 0, song);
      }
      setQueue(newQueue);
    }
  };

  // Play a song from a list/section and queue all remaining songs as "Up Next"
  const playSongFromList = (song, allSongs) => {
    const { activeRoom: currentRoom, isHost: currentIsHost } = stateRef.current;
    if (currentRoom && !currentIsHost && socketRef.current) {
      socketRef.current.emit('request_song', { song, displayName });
      return;
    }
    const songIdx = allSongs.findIndex(s => s.id === song.id);
    // Build queue: all songs starting from the tapped one
    const newQueue = songIdx !== -1 ? allSongs.slice(songIdx) : [song, ...allSongs.filter(s => s.id !== song.id)];
    setQueue(newQueue);
    setCurrentSong(song);
    setIsBuffering(true);
  };

  function addToQueueSilent(song) {
    setQueue(prev => {
      // Only add to queue if it's not already in there (e.g. from a direct search play)
      // We don't want to keep appending the current song to the end every time it plays!
      if (prev.some(s => s.id === song.id)) return prev;
      return [...prev, song];
    });
  };

  const appendToQueue = (song) => {
    const { activeRoom: currentRoom, isHost: currentIsHost } = stateRef.current;
    if (currentRoom && !currentIsHost) return;

    setQueue(prev => [...prev, song]);
  };

  const removeFromQueue = (songId) => {
    const { activeRoom: currentRoom, isHost: currentIsHost } = stateRef.current;
    if (currentRoom && !currentIsHost) return;

    setQueue(prev => prev.filter(s => s.id !== songId));
    if (currentSong?.id === songId) {
      playNext();
    }
  };

  const clearQueue = () => {
    const { activeRoom: currentRoom, isHost: currentIsHost } = stateRef.current;
    if (currentRoom && !currentIsHost) return;
    
    setQueue([]);
    setCurrentSong(null);
    setIsPlaying(false);
    if (playerRef.current && playerRef.current.stopVideo) {
      playerRef.current.stopVideo();
    }
  };

  const playNext = () => {
    const { queue: currentQueue, currentSong: activeSong, repeat: currentRepeat, activeRoom: currentRoom, isHost: currentIsHost } = stateRef.current;
    if (currentQueue.length === 0) return;
    
    // Listeners should request to play next
    if (currentRoom && !currentIsHost) {
      // Find the next song they want to request
      const currentIdx = currentQueue.findIndex(s => s.id === activeSong?.id);
      if (currentIdx !== -1 && currentIdx < currentQueue.length - 1) {
        playSong(currentQueue[currentIdx + 1]);
      }
      return;
    }

    const currentIdx = currentQueue.findIndex(s => s.id === activeSong?.id);
    if (currentIdx === -1) {
      playSong(currentQueue[0]);
    } else if (currentIdx < currentQueue.length - 1) {
      playSong(currentQueue[currentIdx + 1]);
    } else {
      if (currentRepeat === 'all') {
        playSong(currentQueue[0]);
      } else {
        setIsPlaying(false);
      }
    }
  };

  const playPrevious = () => {
    const { queue: currentQueue, currentSong: activeSong, activeRoom: currentRoom, isHost: currentIsHost } = stateRef.current;
    if (currentQueue.length === 0) return;

    if (currentRoom && !currentIsHost) {
      const currentIdx = currentQueue.findIndex(s => s.id === activeSong?.id);
      if (currentIdx > 0) {
        playSong(currentQueue[currentIdx - 1]);
      }
      return;
    }

    if (playerRef.current && playerRef.current.getCurrentTime && playerRef.current.getCurrentTime() > 3) {
      playerRef.current.seekTo(0);
      setCurrentTime(0);
      return;
    }

    const currentIdx = currentQueue.findIndex(s => s.id === activeSong?.id);
    if (currentIdx > 0) {
      playSong(currentQueue[currentIdx - 1]);
    } else if (currentIdx === 0 && repeat === 'all') {
      playSong(currentQueue[currentQueue.length - 1]);
    }
  };

  const handleShuffleToggle = () => {
    const { activeRoom: currentRoom, isHost: currentIsHost } = stateRef.current;
    if (currentRoom && !currentIsHost) return;

    if (!shuffle) {
      setOriginalQueue([...queue]);
      if (queue.length > 1) {
        const currentIdx = queue.findIndex(s => s.id === currentSong?.id);
        const remaining = queue.filter((_, i) => i !== currentIdx);
        for (let i = remaining.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
        }
        const newQueue = currentSong ? [currentSong, ...remaining] : remaining;
        setQueue(newQueue);
      }
      setShuffle(true);
    } else {
      if (originalQueue.length > 0) {
        setQueue(originalQueue);
      }
      setShuffle(false);
    }
  };

  const toggleRepeat = () => {
    const { activeRoom: currentRoom, isHost: currentIsHost } = stateRef.current;
    if (currentRoom && !currentIsHost) return;

    setRepeat(prev => {
      if (prev === 'off') return 'all';
      if (prev === 'all') return 'one';
      return 'off';
    });
  };

  // Favorites Operation with automatic Supabase Cloud Sync
  const toggleFavorite = async (song) => {
    const isAlreadyFav = favorites.some(s => s.id === song.id);
    let newFavs;
    if (isAlreadyFav) {
      newFavs = favorites.filter(s => s.id !== song.id);
    } else {
      newFavs = [...favorites, song];
    }
    setFavorites(newFavs);
    localStorage.setItem('listenup_favorites', JSON.stringify(newFavs));

    // Cloud sync if authenticated
    if (user?.id && isSupabaseConfigured) {
      try {
        if (isAlreadyFav) {
          await supabase
            .from('user_favorites')
            .delete()
            .eq('user_id', user.id)
            .eq('song_id', song.id);
        } else {
          await supabase
            .from('user_favorites')
            .upsert({
              user_id: user.id,
              song_id: song.id,
              song_data: song
            }, { onConflict: 'user_id, song_id' });
        }
      } catch (err) {
        console.warn('Favorite cloud sync error:', err);
      }
    }
  };

  // Playlists Operations with automatic Supabase Cloud Sync
  const createPlaylist = async (name) => {
    const cleanName = name.trim();
    if (!cleanName) return;
    const tempId = 'pl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const newPlaylist = {
      id: tempId,
      name: cleanName,
      songs: []
    };
    setPlaylists(prev => [...prev, newPlaylist]);

    if (user?.id && isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('user_playlists')
          .insert({
            user_id: user.id,
            name: cleanName,
            songs: []
          })
          .select()
          .single();
        if (!error && data) {
          setPlaylists(prev => prev.map(p => p.id === tempId ? { ...p, id: data.id } : p));
        }
      } catch (err) {
        console.warn('Playlist cloud creation error:', err);
      }
    }
  };

  const deletePlaylist = async (playlistId) => {
    setPlaylists(prev => prev.filter(pl => pl.id !== playlistId));
    if (activePlaylistId === playlistId) {
      setActivePlaylistId(null);
    }

    if (user?.id && isSupabaseConfigured) {
      try {
        await supabase
          .from('user_playlists')
          .delete()
          .eq('user_id', user.id)
          .eq('id', playlistId);
      } catch (err) {
        console.warn('Playlist cloud deletion error:', err);
      }
    }
  };

  const addSongToPlaylist = async (playlistId, song) => {
    let targetPlaylist = null;
    setPlaylists(prev => prev.map(pl => {
      if (pl.id !== playlistId) return pl;
      if (pl.songs.some(s => s.id === song.id)) return pl;
      const updated = { ...pl, songs: [...pl.songs, song] };
      targetPlaylist = updated;
      return updated;
    }));

    if (user?.id && isSupabaseConfigured) {
      try {
        const currentPl = targetPlaylist || playlists.find(p => p.id === playlistId);
        const newSongs = currentPl && !currentPl.songs.some(s => s.id === song.id)
          ? [...currentPl.songs, song]
          : (currentPl?.songs || [song]);
        await supabase
          .from('user_playlists')
          .update({ songs: newSongs, updated_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .eq('id', playlistId);
      } catch (err) {
        console.warn('Add song to playlist cloud error:', err);
      }
    }
  };

  const removeSongFromPlaylist = async (playlistId, songId) => {
    let filteredSongs = [];
    setPlaylists(prev => prev.map(pl => {
      if (pl.id !== playlistId) return pl;
      filteredSongs = pl.songs.filter(s => s.id !== songId);
      return { ...pl, songs: filteredSongs };
    }));

    if (user?.id && isSupabaseConfigured) {
      try {
        await supabase
          .from('user_playlists')
          .update({ songs: filteredSongs, updated_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .eq('id', playlistId);
      } catch (err) {
        console.warn('Remove song from playlist cloud error:', err);
      }
    }
  };

  const playPlaylist = (playlist) => {
    if (!playlist || playlist.songs.length === 0) return;
    const { activeRoom: currentRoom, isHost: currentIsHost } = stateRef.current;
    
    // If listener in room, just request the first song (or we could block it)
    if (currentRoom && !currentIsHost && socketRef.current) {
      socketRef.current.emit('request_song', { song: playlist.songs[0], displayName });
      return;
    }

    setQueue(playlist.songs);
    if (shuffle) {
      setOriginalQueue(playlist.songs);
    }
    setCurrentSong(playlist.songs[0]);
    setIsPlaying(true);
  };

  const openCreatePlaylistModal = () => {
    if (createPlaylistDialogRef.current) {
      createPlaylistDialogRef.current.showModal();
    }
  };

  const closeCreatePlaylistModal = () => {
    if (createPlaylistDialogRef.current) {
      createPlaylistDialogRef.current.close();
      setNewPlaylistName('');
    }
  };

  const handleCreatePlaylistSubmit = (e) => {
    e.preventDefault();
    createPlaylist(newPlaylistName);
    closeCreatePlaylistModal();
  };


  const handleSearchSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearchLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setSearchResults(data);
      } else {
        setSearchResults([]);
      }
    } catch (err) {
      console.error(err);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  // Seek bar action
  const handleSeekChange = (e) => {
    const { activeRoom: currentRoom, isHost: currentIsHost } = stateRef.current;
    if (currentRoom && !currentIsHost) return; // Listeners cannot seek
    
    const newTime = parseFloat(e.target.value);
    if (playerRef.current && playerRef.current.seekTo) {
      playerRef.current.seekTo(newTime, true);
    }
  };

  // Format MM:SS helper
  const formatTime = (secs) => {
    if (isNaN(secs) || secs === null) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // GSAP: Animate main content view on tab change
  useGSAP(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (mainContentRef.current) {
      gsap.fromTo(mainContentRef.current,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.38, ease: 'power2.out', clearProps: 'all' }
      );
    }
  }, [activeTab]);

  // GSAP: Hero section entrance choreography
  useGSAP(() => {
    if (activeTab !== 'home' || !heroRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const elements = heroRef.current.querySelectorAll('.gsap-hero');
    if (elements.length > 0) {
      gsap.fromTo(elements,
        { opacity: 0, y: 22 },
        { opacity: 1, y: 0, duration: 0.65, stagger: 0.08, ease: 'power3.out', clearProps: 'all' }
      );
    }
  }, { scope: heroRef, dependencies: [activeTab] });

  // GSAP: Curated category rows entrance
  useGSAP(() => {
    if (homeLoading || activeTab !== 'home' || !categoriesContainerRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const sections = categoriesContainerRef.current.querySelectorAll('.category-section');
    if (sections.length > 0) {
      gsap.fromTo(sections,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.55, stagger: 0.1, ease: 'power2.out', clearProps: 'all' }
      );
    }
  }, { scope: categoriesContainerRef, dependencies: [homeLoading, activeTab] });

  // GSAP: Player track change micro-animation
  useGSAP(() => {
    if (!currentSong) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (playerArtRef.current) {
      gsap.fromTo(playerArtRef.current,
        { scale: 0.88, opacity: 0.5 },
        { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(1.8)', clearProps: 'all' }
      );
    }
    if (playerTitleRef.current) {
      gsap.fromTo(playerTitleRef.current,
        { opacity: 0, x: -8 },
        { opacity: 1, x: 0, duration: 0.3, ease: 'power2.out', clearProps: 'all' }
      );
    }
  }, [currentSong?.id]);

  // Global Keyboard Shortcut: Cmd/Ctrl + K for Search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setActiveTab('search');
        setTimeout(() => {
          searchInputRef.current?.focus();
        }, 80);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleQuickTagClick = (tag) => {
    setSearchQuery(tag);
    setActiveTab('search');
    setSearchLoading(true);
    fetch(`${API_BASE_URL}/api/search?q=${encodeURIComponent(tag)}`)
      .then(res => res.json())
      .then(data => {
        setSearchResults(Array.isArray(data) ? data : []);
      })
      .catch(() => setSearchResults([]))
      .finally(() => setSearchLoading(false));
  };

  const playFeaturedMix = () => {
    if (homeData.trending && homeData.trending.length > 0) {
      playSongFromList(homeData.trending[0], homeData.trending);
    }
  };

  // Personalized Artists Shelf: Prioritizes user's favourite artists
  const displayedArtists = useMemo(() => {
    const baseList = [
      { name: 'Arijit Singh', img: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80', query: 'arijit singh best songs' },
      { name: 'Shreya Ghoshal', img: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80', query: 'shreya ghoshal hit songs' },
      { name: 'Diljit Dosanjh', img: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=300&auto=format&fit=crop&q=80', query: 'diljit dosanjh top tracks' },
      { name: 'A. R. Rahman', img: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&auto=format&fit=crop&q=80', query: 'ar rahman hit songs' },
      { name: 'Sonu Nigam', img: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=300&auto=format&fit=crop&q=80', query: 'sonu nigam evergreen songs' },
      { name: 'Sunidhi Chauhan', img: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=300&auto=format&fit=crop&q=80', query: 'sunidhi chauhan hit songs' },
      { name: 'Ayushmann', img: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=300&auto=format&fit=crop&q=80', query: 'ayushmann khurrana songs' },
      { name: 'Jubin Nautiyal', img: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=300&auto=format&fit=crop&q=80', query: 'jubin nautiyal best songs' }
    ];

    if (!preferences?.artists || preferences.artists.length === 0) {
      return baseList;
    }

    const userFavs = preferences.artists.map(art => {
      const name = typeof art === 'string' ? art : art.name;
      const starter = STARTER_ARTISTS.find(sa => sa.name.toLowerCase() === name.toLowerCase());
      return {
        name,
        img: starter?.imageUrl || (typeof art === 'object' && art.imageUrl) || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80',
        query: `${name} best songs official`,
        isUserFav: true
      };
    });

    const remaining = baseList.filter(b => !userFavs.some(u => u.name.toLowerCase() === b.name.toLowerCase()));
    return [...userFavs, ...remaining];
  }, [preferences?.artists]);

  return (
    <div className="flex flex-col h-[100dvh] w-screen bg-[#08080D] text-[#F5F5F7] overflow-hidden relative font-sans select-none antialiased">
      {/* Dynamic Subtle Atmospheric Glow & Noise */}
      <div className="absolute top-[-10%] left-1/4 w-[50%] h-[45%] bg-[#D5F36A]/5 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[45%] h-[50%] bg-[#191922]/40 rounded-full blur-[160px] pointer-events-none" />
      <div className="absolute inset-0 noise-overlay pointer-events-none z-0" />

      {/* Main Workspace Row: Sidebar + Main Content (terminates cleanly above footer) */}
      <div className="flex-1 flex overflow-hidden relative z-10 min-h-0">
        {/* Mobile Sidebar Overlay */}
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black/75 backdrop-blur-md z-40 md:hidden transition-opacity cursor-pointer"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Left Sidebar */}
        <aside className={`fixed md:relative inset-y-0 left-0 md:inset-auto transform ${isMobileMenuOpen ? 'translate-x-0 shadow-[0_0_50px_rgba(0,0,0,0.9)]' : '-translate-x-full'} md:translate-x-0 w-72 max-w-[80vw] h-full bg-[#08080D] border-r border-white/[0.08] flex flex-col z-50 md:z-20 transition-transform duration-300 ease-out flex-shrink-0`}>
        {/* App Branding */}
        <div className="p-6 flex items-center justify-between border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#D5F36A]/10 border border-[#D5F36A]/30 flex items-center justify-center p-1.5 shadow-lg shadow-[#D5F36A]/5">
              <img src="/logo.png" alt="ListenUp Logo" className="h-6 w-auto object-contain drop-shadow" />
            </div>
            <div>
              <h1 className="font-display text-xl font-extrabold text-[#F5F5F7] tracking-tight flex items-center gap-1">
                Listen<span className="text-[#D5F36A]">Up</span>
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D5F36A] animate-pulse"></span>
                <p className="text-[10px] text-[#9999A6] uppercase tracking-widest font-semibold font-mono">Studio v2.4</p>
              </div>
            </div>
          </div>
          {/* Mobile close toggle */}
          <button 
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden p-1.5 rounded-lg text-[#9999A6] hover:text-white hover:bg-white/[0.06]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto custom-scrollbar">
          {[
            {
              id: 'home',
              label: 'Discover',
              icon: (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                </svg>
              ),
              badge: null
            },
            {
              id: 'search',
              label: 'Search',
              icon: (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              ),
              badge: '⌘K'
            },
            {
              id: 'favorites',
              label: 'Favorites',
              icon: (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                </svg>
              ),
              badge: favorites.length > 0 ? favorites.length : null
            },
            {
              id: 'playlists',
              label: 'My Music',
              icon: (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              ),
              badge: playlists.length > 0 ? playlists.length : null
            },
            {
              id: 'rooms',
              label: 'Music Rooms',
              icon: (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              ),
              badge: activeRoom ? 'LIVE' : null
            },
            {
              id: 'queue',
              label: 'Recently Played',
              icon: (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
              badge: recentlyPlayed.length > 0 ? recentlyPlayed.length : (queue.length > 0 ? queue.length : null)
            }
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'playlists') setActivePlaylistId(null);
                  setIsMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl transition-all duration-200 group text-left cursor-pointer ${
                  isActive
                    ? 'bg-[#D5F36A]/10 text-[#D5F36A] border border-[#D5F36A]/30 font-bold'
                    : 'text-[#9999A6] hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`${isActive ? 'text-[#D5F36A]' : 'text-[#9999A6] group-hover:text-slate-200'} transition-colors`}>
                    {tab.icon}
                  </span>
                  <span className="text-sm font-medium">{tab.label}</span>
                </div>
                {tab.badge && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    tab.badge === 'LIVE'
                      ? 'bg-[#D5F36A]/20 text-[#D5F36A] border border-[#D5F36A]/30 animate-pulse'
                      : tab.badge === '⌘K'
                      ? 'bg-white/[0.06] text-[#9999A6] border border-white/[0.08] font-mono'
                      : 'bg-[#D5F36A]/15 text-[#D5F36A] border border-[#D5F36A]/25'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Bottom Creator Card */}
        <div className="p-4 border-t border-white/[0.06] flex flex-col gap-3 mt-auto">
          {/* Hidden YouTube Container */}
          <div className="absolute top-[-9999px] left-[-9999px] opacity-0 pointer-events-none w-[1px] h-[1px] overflow-hidden">
            <div id="yt-player-iframe"></div>
            <audio ref={silentAudioRef} loop src="data:audio/mp3;base64,//OExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"></audio>
          </div>
          
          <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#191922] border border-white/[0.08] text-[#D5F36A] flex items-center justify-center text-xs font-bold shadow">
                PJ
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">Prateek Jaiswal</p>
                <p className="text-[10px] text-[#9999A6] truncate">Lead Developer</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <a 
                href="https://github.com/prateek977" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="p-1.5 rounded-lg text-[#9999A6] hover:text-white hover:bg-white/[0.08] transition-colors"
                title="GitHub"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
              </a>
              <a 
                href="https://www.linkedin.com/in/prateek-jaiswal-44b580377/" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="p-1.5 rounded-lg text-[#9999A6] hover:text-[#D5F36A] hover:bg-white/[0.08] transition-colors"
                title="LinkedIn"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                </svg>
              </a>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Dashboard Panels */}
      <main ref={mainContentRef} className="flex-1 flex flex-col h-full overflow-y-auto pb-8 px-4 md:px-8 py-4 md:py-6 z-10">

        {/* SEO Visually Hidden Content */}
        <section className="sr-only">
          <h2>What is ListenUp?</h2>
          <p>ListenUp is a premium, real-time collaborative music streaming platform. Search and stream an unlimited library of music directly from YouTube.</p>
        </section>

        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between mb-5 pb-3 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 -ml-2 rounded-xl text-[#9999A6] hover:text-white hover:bg-white/[0.06]"
              aria-label="Open navigation menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="ListenUp Logo" className="h-6 w-auto object-contain drop-shadow" />
              <span className="font-display text-lg font-extrabold text-[#F5F5F7] tracking-tight">Listen<span className="text-[#D5F36A]">Up</span></span>
            </div>
          </div>

          <button 
            onClick={() => setActiveTab('search')}
            className="p-2 rounded-xl text-[#9999A6] hover:text-white hover:bg-white/[0.06]"
            aria-label="Search"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </button>
        </div>

        {/* Onboarding Flow: ONLY show when user first created account and has not completed onboarding */}
        {user && !authLoading && profile && profile.onboarding_completed === false && localStorage.getItem(`listenup_onboarding_completed_${user.id}`) !== 'true' ? (
          <div className="max-w-4xl mx-auto w-full pb-12 animate-fade-in">
            <OnboardingFlow 
              onComplete={() => {
                if (user) {
                  localStorage.setItem(`listenup_onboarding_completed_${user.id}`, 'true');
                  localStorage.removeItem(`listenup_needs_onboarding_${user.id}`);
                }
                localStorage.removeItem('listenup_onboarding_draft');
                sessionStorage.removeItem('listenup_just_signed_up');
                fetchHomeData();
                fetchSuggestedSongs();
                setActiveTab('home');
              }} 
            />
          </div>
        ) : (
          <>
            {/* Active View: HOME */}
            {activeTab === 'home' && (
          <div className="flex flex-col gap-6 md:gap-8 max-w-5xl mx-auto w-full pb-6">
            
            {/* Top Bar matching reference: 2x2 grid icon, Greeting & Name, Notification, Avatar */}
            <div className="flex items-center justify-between pt-1 pb-1">
              <div className="flex items-center gap-3.5">
                {/* 2x2 Grid Icon Button */}
                <button
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                  className="w-10 h-10 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] flex items-center justify-center text-[#9999A6] hover:text-white transition-all active:scale-95 flex-shrink-0 cursor-pointer"
                  aria-label="Toggle navigation menu"
                  title="Toggle Navigation Menu"
                >
                  <div className="grid grid-cols-2 gap-1 w-4 h-4">
                    <span className="w-1.5 h-1.5 rounded-sm bg-slate-300"></span>
                    <span className="w-1.5 h-1.5 rounded-sm bg-slate-300"></span>
                    <span className="w-1.5 h-1.5 rounded-sm bg-slate-300"></span>
                    <span className="w-1.5 h-1.5 rounded-sm bg-[#D5F36A]"></span>
                  </div>
                </button>

                {/* Greeting and User Name */}
                <div>
                  <p className="text-[11px] md:text-xs font-medium text-[#9999A6] tracking-wide">
                    {getGreeting()}
                  </p>
                  <h2 className="font-heading text-lg md:text-2xl font-extrabold text-[#F5F5F7] tracking-tight flex items-center">
                    {user ? (profile?.display_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Listener') : (displayName ? displayName.replace(/^Listener-/, '') : 'Guest')}
                    <span className="text-[#D5F36A] text-xl font-bold ml-0.5">.</span>
                  </h2>
                </div>
              </div>

              {/* Right Controls: Notification Bell + Auth / Avatar */}
              <div className="flex items-center gap-3">
                {/* Notification Bell */}
                <div className="relative">
                  <button
                    onClick={() => setIsNotificationOpen(!isNotificationOpen)}
                    className="w-10 h-10 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] flex items-center justify-center text-[#9999A6] hover:text-white transition-all active:scale-95 relative cursor-pointer"
                    aria-label="Notifications"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                    </svg>
                    {/* Notification dot */}
                    <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-[#D5F36A] ring-2 ring-[#08080D] animate-pulse"></span>
                  </button>

                  {/* Notification Dropdown */}
                  {isNotificationOpen && (
                    <div className="absolute right-0 mt-2 w-72 p-4 rounded-2xl bg-[#191922] border border-white/[0.08] shadow-2xl z-50">
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/[0.06]">
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">Notifications</h4>
                        <span className="text-[10px] text-[#D5F36A] font-semibold">{pendingSongRequests.length} pending</span>
                      </div>
                      {pendingSongRequests.length > 0 ? (
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {pendingSongRequests.map(r => (
                            <div key={r.id} className="text-xs text-slate-300 p-2 rounded-lg bg-white/[0.03] border border-white/[0.04]">
                              <p className="font-semibold text-white truncate">{r.song.title}</p>
                              <p className="text-[10px] text-[#D5F36A]">from {r.requestedBy}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[#9999A6] py-3 text-center">No new notifications. All quiet!</p>
                      )}
                      {activeRoom && (
                        <div className="mt-2 pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs">
                          <span className="text-[#9999A6]">Live Room:</span>
                          <span className="text-[#D5F36A] font-mono font-bold">{activeRoom}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Authenticated Avatar / Guest Sign-in */}
                {user ? (
                  <button
                    onClick={() => setIsProfileModalOpen(true)}
                    className="relative p-0.5 rounded-full ring-2 ring-[#D5F36A]/80 shadow-[0_0_12px_rgba(213,243,106,0.35)] active:scale-95 transition-all flex-shrink-0 cursor-pointer group"
                    aria-label="User Profile and Preferences"
                    title="Profile & Taste Preferences"
                  >
                    <div className="w-9 h-9 rounded-full overflow-hidden bg-slate-800 flex items-center justify-center">
                      <img
                        src={profile?.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.id}`}
                        alt="Avatar"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#D5F36A] rounded-full border-2 border-[#08080D]" />
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setAuthModalMode('signin');
                      setIsAuthModalOpen(true);
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-[#D5F36A] hover:bg-[#BDE84A] text-black font-extrabold text-xs shadow-md shadow-[#D5F36A]/20 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer flex-shrink-0"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                    </svg>
                    <span>Sign In</span>
                  </button>
                )}
              </div>
            </div>

            {/* Filter Category Pills & Search Button */}
            <div className="flex items-center justify-between gap-2 overflow-x-auto hide-scrollbar pb-1">
              <div className="flex items-center gap-2">
                {[
                  { id: 'music', label: 'Music' },
                  { id: 'podcasts', label: 'Podcasts' },
                  { id: 'audiobooks', label: 'Audiobooks' },
                  { id: 'live', label: 'Live' }
                ].map(tab => {
                  const isActive = activeCategoryFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setActiveCategoryFilter(tab.id);
                        if (tab.id === 'music') {
                          setActiveTab('home');
                        } else if (tab.id === 'podcasts') {
                          setActiveTab('search');
                          handleQuickTagClick('top podcast full episodes');
                        } else if (tab.id === 'audiobooks') {
                          setActiveTab('search');
                          handleQuickTagClick('audiobook full playlist');
                        } else if (tab.id === 'live') {
                          setActiveTab('rooms');
                        }
                      }}
                      className={`px-5 py-2 rounded-2xl text-xs md:text-sm font-bold transition-all flex-shrink-0 cursor-pointer ${
                        isActive
                          ? 'bg-[#D5F36A] text-black shadow-md'
                          : 'bg-[#191922] hover:bg-white/[0.08] text-[#9999A6] hover:text-white border border-white/[0.08]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Search Button */}
              <button
                onClick={() => setActiveTab('search')}
                className="w-10 h-10 rounded-2xl bg-[#191922] hover:bg-white/[0.08] border border-white/[0.08] flex items-center justify-center text-[#9999A6] hover:text-white transition-all active:scale-95 flex-shrink-0 ml-1 cursor-pointer"
                aria-label="Search"
                title="Search Music"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </button>
            </div>

            {/* Dynamic Featured Hero Banner */}
            {(() => {
              const featuredSong = currentSong || (homeData.trending && homeData.trending.length > 0 ? homeData.trending[0] : null);
              const heroTitle = featuredSong ? featuredSong.title : 'Bollywood & Global Hits';
              const heroArtist = featuredSong ? (featuredSong.artist || 'Top Trending on ListenUp') : 'Stream millions of tracks in studio quality';
              const heroImg = featuredSong?.thumbnailUrl || 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=1200&auto=format&fit=crop&q=80';
              const isHeroPlaying = isPlaying && currentSong?.id === featuredSong?.id;

              return (
                <div ref={heroRef} className="space-y-3">
                  <div className="relative rounded-3xl overflow-hidden border border-white/[0.08] shadow-2xl bg-[#101017]">
                    {/* Dynamic Background Image with atmospheric overlays */}
                    <div className="absolute inset-0 z-0">
                      <img
                        src={heroImg}
                        alt={heroTitle}
                        onError={(e) => {
                          e.currentTarget.src = 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=1200&auto=format&fit=crop&q=80';
                        }}
                        className="w-full h-full object-cover opacity-45 filter brightness-90 saturate-150 transform scale-105 hover:scale-110 transition-transform duration-1000 ease-out"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#08080D] via-[#08080D]/60 to-transparent pointer-events-none" />
                      <div className="absolute inset-0 bg-gradient-to-r from-[#08080D]/90 via-transparent to-black/40 pointer-events-none" />
                    </div>

                    {/* Content */}
                    <div className="relative z-10 p-6 md:p-8 flex flex-col justify-between min-h-[210px] md:min-h-[250px]">
                      {/* Top Trending / Now Playing Badge */}
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-bold text-[#D5F36A] shadow-sm">
                          <span className={`w-2 h-2 rounded-full ${isHeroPlaying ? 'bg-[#D5F36A] animate-ping' : 'bg-[#D5F36A] animate-pulse'}`}></span>
                          {isHeroPlaying ? 'Now Playing' : '🔥 Featured Hit'}
                        </span>
                        {featuredSong?.viewCount && (
                          <span className="hidden sm:inline-flex text-[10px] text-[#9999A6] font-mono bg-black/40 backdrop-blur px-2 py-0.5 rounded-full border border-white/5">
                            {(featuredSong.viewCount / 1000000).toFixed(1)}M+ plays
                          </span>
                        )}
                      </div>

                      {/* Bottom: Title, Subtitle, and Floating Play Button */}
                      <div className="flex items-end justify-between gap-4 mt-6">
                        <div className="space-y-1.5 max-w-lg">
                          <h3 className="font-heading text-xl sm:text-2xl md:text-3xl font-extrabold text-[#F5F5F7] tracking-tight leading-tight drop-shadow-md line-clamp-2">
                            {heroTitle}
                          </h3>
                          <p className="text-xs sm:text-sm text-[#9999A6] font-medium leading-relaxed drop-shadow truncate">
                            {heroArtist}
                          </p>
                        </div>

                        {/* Floating Lime Circular Play Button */}
                        <button
                          onClick={() => {
                            if (currentSong && featuredSong && currentSong.id === featuredSong.id) {
                              setIsPlaying(!isPlaying);
                            } else if (featuredSong) {
                              playSongFromList(featuredSong, homeData.trending.length > 0 ? homeData.trending : [featuredSong]);
                            } else {
                              playFeaturedMix();
                            }
                          }}
                          className="w-13 h-13 md:w-14 md:h-14 rounded-full bg-[#D5F36A] hover:bg-[#BDE84A] text-black flex items-center justify-center shadow-[0_0_24px_rgba(213,243,106,0.4)] active:scale-90 transition-all flex-shrink-0 group cursor-pointer"
                          aria-label={isHeroPlaying ? "Pause Track" : "Play Track"}
                          title={isHeroPlaying ? "Pause Track" : "Play Track"}
                        >
                          {isHeroPlaying ? (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                            </svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 translate-x-0.5 group-hover:scale-110 transition-transform">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Carousel Pagination Dots */}
                  <div className="flex items-center justify-center gap-1.5">
                    <span className="w-5 h-1.5 rounded-full bg-[#D5F36A] shadow-[0_0_8px_rgba(213,243,106,0.6)]"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-white/20"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-white/20"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-white/20"></span>
                  </div>
                </div>
              );
            })()}

            {/* Section 1: Dynamic Recently Played */}
            <section className="space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <h3 className="font-heading text-lg md:text-xl font-bold text-white tracking-tight">
                    Recently Played
                  </h3>
                  {recentlyPlayed.length > 0 && (
                    <span className="text-[10px] font-mono font-bold text-[#D5F36A] bg-[#D5F36A]/10 border border-[#D5F36A]/20 px-2 py-0.5 rounded-full">
                      {recentlyPlayed.length} {recentlyPlayed.length === 1 ? 'track' : 'tracks'}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setActiveTab('queue')}
                  className="text-xs font-semibold text-[#9999A6] hover:text-[#D5F36A] flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <span>See All</span>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-3 h-3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              </div>

              {/* Dynamic Song Cards */}
              <div className="flex gap-3.5 overflow-x-auto hide-scrollbar pb-1">
                {(() => {
                  const displaySongs = recentlyPlayed.length > 0 
                    ? recentlyPlayed 
                    : (homeData.trending.length > 0 
                        ? homeData.trending.slice(0, 8) 
                        : (homeData.bollywood.length > 0 ? homeData.bollywood.slice(0, 8) : []));

                  if (displaySongs.length === 0) {
                    return (
                      <div className="w-full py-8 text-center text-xs text-[#9999A6] border border-dashed border-white/10 rounded-2xl">
                        No songs played yet. Pick any track below to start streaming!
                      </div>
                    );
                  }

                  return displaySongs.map((song) => {
                    const isCurrent = currentSong?.id === song.id;

                    return (
                      <div
                        key={song.id}
                        onClick={() => playSongFromList(song, displaySongs)}
                        className="w-36 sm:w-44 flex-shrink-0 group cursor-pointer"
                      >
                        <div className={`relative aspect-square w-full rounded-2xl overflow-hidden bg-[#101017] border shadow-lg transition-all ${
                          isCurrent 
                            ? 'border-[#D5F36A] shadow-[0_0_18px_rgba(213,243,106,0.3)] ring-1 ring-[#D5F36A]' 
                            : 'border-white/[0.08] group-hover:border-[#D5F36A]/50'
                        }`}>
                          <img
                            src={song.thumbnailUrl}
                            alt={song.title}
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop&q=80';
                            }}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none" />
                          
                          {/* Duration Badge / Playing Equalizer Animation */}
                          {isCurrent && isPlaying ? (
                            <div className="absolute top-2 right-2 bg-black/85 backdrop-blur-md px-2 py-1 rounded-full flex items-center gap-1 border border-[#D5F36A]/40 shadow-sm pointer-events-none">
                              <span className="eq-bar !h-3"></span>
                              <span className="eq-bar !h-4"></span>
                              <span className="eq-bar !h-2"></span>
                            </div>
                          ) : song.duration ? (
                            <span className="absolute top-2 right-2 text-[10px] font-mono font-semibold bg-black/75 backdrop-blur-md px-1.5 py-0.5 rounded text-slate-300 pointer-events-none">
                              {formatTime(song.duration)}
                            </span>
                          ) : null}

                          {/* Hover Play Button */}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="w-10 h-10 rounded-full bg-[#D5F36A] text-black flex items-center justify-center shadow-lg shadow-[#D5F36A]/30 transform scale-75 group-hover:scale-100 transition-transform">
                              {isCurrent && isPlaying ? (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                                </svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 translate-x-0.5">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                              )}
                            </div>
                          </div>

                          {/* Bottom Card Title and Artist */}
                          <div className="absolute bottom-2.5 left-2.5 right-2.5">
                            <p className="text-xs font-bold text-white truncate drop-shadow" title={song.title}>
                              {song.title}
                            </p>
                            <p className="text-[10px] text-[#9999A6] font-medium truncate mt-0.5" title={song.artist}>
                              {song.artist || 'Playback'}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </section>

            {/* Section: Suggested Songs (Personalized for Client with Preferences) */}
            <section className="space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#D5F36A] flex items-center justify-center shadow-md shadow-[#D5F36A]/20">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-black">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-heading text-lg md:text-xl font-bold text-white tracking-tight">
                        Suggested Songs
                      </h3>
                      <span className="text-[10px] font-mono font-medium text-[#D5F36A] bg-[#D5F36A]/10 border border-[#D5F36A]/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#D5F36A] animate-pulse"></span>
                        For Your Taste
                      </span>
                    </div>
                    <p className="text-[11px] text-[#9999A6] line-clamp-1">
                      {suggestedMixTitle || 'Curated tracks matching your favourite artists & music genres'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchSuggestedSongs}
                    disabled={suggestedLoading}
                    className="p-2 sm:px-3 sm:py-1.5 rounded-xl bg-[#191922] hover:bg-white/[0.08] border border-white/[0.08] text-[#9999A6] hover:text-white transition-all text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title="Refresh Suggested Songs"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className={`w-3.5 h-3.5 ${suggestedLoading ? 'animate-spin text-[#D5F36A]' : ''}`}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    <span className="hidden sm:inline">Refresh</span>
                  </button>

                  <button
                    onClick={() => setIsProfileModalOpen(true)}
                    className="px-3 py-1.5 rounded-xl bg-[#191922] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-semibold text-[#9999A6] hover:text-[#D5F36A] transition-colors cursor-pointer"
                    title="Update your taste preferences"
                  >
                    <span>Preferences</span>
                  </button>
                </div>
              </div>

              {/* Preference Badges */}
              {(preferences?.artists?.length > 0 || preferences?.genres?.length > 0 || preferences?.languages?.length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-[10px] font-mono text-[#666674] uppercase tracking-wider mr-1">Tuned to:</span>
                  {preferences.artists?.slice(0, 3).map(art => {
                    const name = typeof art === 'string' ? art : art.name;
                    return (
                      <span key={name} className="px-2 py-0.5 rounded-md bg-[#D5F36A]/10 border border-[#D5F36A]/20 text-[#D5F36A] text-[11px] font-medium flex items-center gap-1">
                        <span>🎤</span>
                        <span>{name}</span>
                      </span>
                    );
                  })}
                  {preferences.genres?.slice(0, 2).map(genre => (
                    <span key={genre} className="px-2 py-0.5 rounded-md bg-[#191922] border border-white/[0.08] text-[#9999A6] text-[11px] font-medium capitalize flex items-center gap-1">
                      <span>🎵</span>
                      <span>{genre}</span>
                    </span>
                  ))}
                  {preferences.languages?.slice(0, 2).map(lang => (
                    <span key={lang} className="px-2 py-0.5 rounded-md bg-[#191922] border border-white/[0.08] text-[#9999A6] text-[11px] font-medium flex items-center gap-1">
                      <span>🌐</span>
                      <span>{lang}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Song Cards Carousel */}
              <div className="flex gap-3.5 overflow-x-auto hide-scrollbar pb-1">
                {suggestedLoading && suggestedSongs.length === 0 ? (
                  [1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="w-36 sm:w-44 flex-shrink-0 space-y-2">
                      <div className="skeleton-shimmer aspect-square w-full rounded-2xl"></div>
                      <div className="skeleton-shimmer h-3.5 w-28 rounded"></div>
                      <div className="skeleton-shimmer h-2.5 w-16 rounded"></div>
                    </div>
                  ))
                ) : suggestedSongs.length === 0 ? (
                  <div className="w-full py-8 text-center text-xs text-[#9999A6] border border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-2">
                    <p>No suggested songs found yet for your current taste.</p>
                    <button
                      onClick={() => setIsProfileModalOpen(true)}
                      className="px-4 py-1.5 rounded-xl bg-[#D5F36A] text-black font-bold text-xs"
                    >
                      Set Up Your Preferences
                    </button>
                  </div>
                ) : (
                  suggestedSongs.map(song => {
                    const isCurrent = currentSong?.id === song.id;
                    const isFav = favorites.some(s => s.id === song.id);

                    return (
                      <div
                        key={song.id}
                        onClick={() => playSongFromList(song, suggestedSongs)}
                        className="w-36 sm:w-44 flex-shrink-0 group cursor-pointer"
                      >
                        <div className={`relative aspect-square w-full rounded-2xl overflow-hidden bg-[#101017] border shadow-lg transition-all ${
                          isCurrent 
                            ? 'border-[#D5F36A] shadow-[0_0_18px_rgba(213,243,106,0.3)] ring-1 ring-[#D5F36A]' 
                            : 'border-white/[0.08] group-hover:border-[#D5F36A]/50'
                        }`}>
                          <img
                            src={song.thumbnailUrl}
                            alt={song.title}
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop&q=80';
                            }}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none" />
                          
                          {/* Duration Badge / Playing Equalizer Animation */}
                          {isCurrent && isPlaying ? (
                            <div className="absolute top-2 right-2 bg-black/85 backdrop-blur-md px-2 py-1 rounded-full flex items-center gap-1 border border-[#D5F36A]/40 shadow-sm pointer-events-none">
                              <span className="eq-bar !h-3"></span>
                              <span className="eq-bar !h-4"></span>
                              <span className="eq-bar !h-2"></span>
                            </div>
                          ) : song.duration ? (
                            <span className="absolute top-2 right-2 text-[10px] font-mono font-semibold bg-black/75 backdrop-blur-md px-1.5 py-0.5 rounded text-slate-300 pointer-events-none">
                              {formatTime(song.duration)}
                            </span>
                          ) : null}

                          {/* Quick Favorite Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(song);
                            }}
                            className={`absolute top-2 left-2 p-1.5 rounded-full backdrop-blur-md transition-all cursor-pointer ${
                              isFav ? 'bg-rose-500 text-white' : 'bg-black/60 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-white'
                            }`}
                            title={isFav ? "Remove from favorites" : "Add to favorites"}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={isFav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                            </svg>
                          </button>

                          {/* Hover Play Button */}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="w-10 h-10 rounded-full bg-[#D5F36A] text-black flex items-center justify-center shadow-lg shadow-[#D5F36A]/30 transform scale-75 group-hover:scale-100 transition-transform active:scale-95">
                              {isCurrent && isPlaying ? (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                                </svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 translate-x-0.5">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                              )}
                            </div>
                          </div>

                          {/* Bottom Card Title and Artist */}
                          <div className="absolute bottom-2.5 left-2.5 right-2.5">
                            <p className="text-xs font-bold text-white truncate drop-shadow" title={song.title}>
                              {song.title}
                            </p>
                            <p className="text-[10px] text-[#9999A6] font-medium truncate mt-0.5" title={song.artist}>
                              {song.artist || 'Playback'}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* Section 2: Dynamic Made For You (Curated Mixes from Live Catalog) */}
            <section className="space-y-3.5">
              <div className="flex items-center justify-between">
                <h3 className="font-heading text-lg md:text-xl font-bold text-white tracking-tight">
                  Made For You
                </h3>
                <button
                  onClick={() => setActiveTab('search')}
                  className="text-xs font-semibold text-[#9999A6] hover:text-[#D5F36A] flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <span>Explore more</span>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-3 h-3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              </div>

              <div className="flex gap-3.5 overflow-x-auto hide-scrollbar pb-1">
                {[
                  {
                    mixTitle: 'Sad Songs & Melodies',
                    badge: 'Heartbreak & Soul',
                    category: 'sad',
                    song: homeData.sad?.[0],
                    fallbackImg: 'https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=400&auto=format&fit=crop&q=80'
                  },
                  {
                    mixTitle: 'Daily Bollywood Mix',
                    badge: 'Your Mix',
                    category: 'bollywood',
                    song: homeData.bollywood?.[0],
                    fallbackImg: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop&q=80'
                  },
                  {
                    mixTitle: 'Top Trending Hits',
                    badge: 'Hot Right Now',
                    category: 'trending',
                    song: homeData.trending?.[0],
                    fallbackImg: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=400&auto=format&fit=crop&q=80'
                  },
                  {
                    mixTitle: 'Lo-Fi Chill Sanctuary',
                    badge: 'Deep Focus',
                    category: 'lofi',
                    song: homeData.lofi?.[0],
                    fallbackImg: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&auto=format&fit=crop&q=80'
                  },
                  {
                    mixTitle: 'High-Energy Party Mix',
                    badge: 'Top Picks',
                    category: 'party',
                    song: homeData.party?.[0],
                    fallbackImg: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&auto=format&fit=crop&q=80'
                  },
                  {
                    mixTitle: 'Romantic Melodies',
                    badge: 'Heartstrings',
                    category: 'romantic',
                    song: homeData.romantic?.[0],
                    fallbackImg: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=400&auto=format&fit=crop&q=80'
                  },
                  {
                    mixTitle: 'Global Pop Chartbusters',
                    badge: 'Worldwide',
                    category: 'hollywood',
                    song: homeData.hollywood?.[0],
                    fallbackImg: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80'
                  }
                ].map(card => {
                  const songList = homeData[card.category] || [];
                  const previewImg = card.song?.thumbnailUrl || card.fallbackImg;
                  const displayTitle = card.song ? card.song.title : card.mixTitle;

                  return (
                    <div
                      key={card.mixTitle}
                      onClick={() => {
                        if (songList.length > 0) {
                          playSongFromList(card.song || songList[0], songList);
                        } else {
                          handleQuickTagClick(card.mixTitle);
                        }
                      }}
                      className="w-36 sm:w-44 flex-shrink-0 group cursor-pointer"
                    >
                      <div className="relative aspect-square w-full rounded-2xl overflow-hidden bg-[#101017] border border-white/[0.08] shadow-lg group-hover:border-[#D5F36A]/50 transition-all">
                        <img
                          src={previewImg}
                          alt={card.mixTitle}
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.src = card.fallbackImg;
                          }}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none" />
                        
                        {/* Mix Badge */}
                        <span className="absolute top-2 left-2 text-[10px] font-bold bg-black/70 backdrop-blur-md text-[#D5F36A] border border-[#D5F36A]/30 px-2 py-0.5 rounded-full pointer-events-none">
                          {card.badge}
                        </span>

                        {/* Play Hover Button */}
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <div className="w-10 h-10 rounded-full bg-[#D5F36A] text-black flex items-center justify-center shadow-lg shadow-[#D5F36A]/30 transform scale-75 group-hover:scale-100 transition-transform">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 translate-x-0.5">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </div>
                        </div>

                        {/* Text Overlay */}
                        <div className="absolute bottom-2.5 left-2.5 right-2.5">
                          <p className="text-xs font-bold text-white truncate drop-shadow" title={displayTitle}>
                            {card.mixTitle}
                          </p>
                          <p className="text-[10px] text-[#9999A6] font-medium truncate mt-0.5" title={card.song?.title || card.badge}>
                            {card.song ? card.song.title : `${songList.length} tracks`}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Section 3: Popular Artists / From Your Favourite Artists */}
            <section className="space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <h3 className="font-heading text-lg md:text-xl font-bold text-white tracking-tight">
                    {preferences?.artists?.length > 0 ? '⭐ From Your Favourite Artists' : 'Popular Artists'}
                  </h3>
                  {preferences?.artists?.length > 0 && (
                    <span className="text-[10px] font-mono font-medium text-[#D5F36A] bg-[#D5F36A]/10 border border-[#D5F36A]/20 px-2 py-0.5 rounded-full">
                      Personalized
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setActiveTab('search')}
                  className="text-xs font-semibold text-[#9999A6] hover:text-[#D5F36A] flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <span>See all</span>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-3 h-3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              </div>

              <div className="flex gap-4 overflow-x-auto hide-scrollbar pb-1">
                {displayedArtists.map(artist => (
                  <div
                    key={artist.name}
                    onClick={() => {
                      setActiveTab('search');
                      handleQuickTagClick(artist.query);
                    }}
                    className="flex flex-col items-center gap-2 flex-shrink-0 group cursor-pointer relative"
                  >
                    <div className={`w-18 h-18 sm:w-20 sm:h-20 rounded-full overflow-hidden p-0.5 border-2 transition-all bg-[#101017] ${
                      artist.isUserFav 
                        ? 'border-[#D5F36A] shadow-[0_0_15px_rgba(213,243,106,0.35)]' 
                        : 'border-white/[0.08] group-hover:border-[#D5F36A] group-hover:shadow-[0_0_15px_rgba(213,243,106,0.3)]'
                    }`}>
                      <img
                        src={artist.img}
                        alt={artist.name}
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&auto=format&fit=crop&q=80';
                        }}
                        className="w-full h-full rounded-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                    <span className="text-[11px] sm:text-xs font-semibold text-[#9999A6] group-hover:text-[#D5F36A] truncate max-w-[85px] text-center" title={artist.name}>
                      {artist.name}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Curated Music Category Rows from API */}
            {homeLoading ? (
              <div className="space-y-6 pt-2">
                {['🔥 Top Trending', '🇮🇳 Bollywood Hits', '🇬🇧 Hollywood Pop'].map((title) => (
                  <div key={title} className="space-y-3">
                    <div className="skeleton-shimmer h-5 w-36 rounded"></div>
                    <div className="flex gap-3 overflow-x-hidden">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="w-36 flex-shrink-0 space-y-2">
                          <div className="skeleton-shimmer w-36 h-36 rounded-2xl"></div>
                          <div className="skeleton-shimmer h-3.5 w-28 rounded"></div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div ref={categoriesContainerRef} className="space-y-8 pt-2">
                {Object.entries(homeData).sort(([catA], [catB]) => {
                  const userGenres = (preferences?.genres || []).map(g => g.toLowerCase());
                  const aMatch = userGenres.some(g => g.includes(catA) || catA.includes(g));
                  const bMatch = userGenres.some(g => g.includes(catB) || catB.includes(g));
                  if (aMatch && !bMatch) return -1;
                  if (!aMatch && bMatch) return 1;
                  return 0;
                }).map(([key, songs]) => {
                  if (songs.length === 0) return null;
                  
                  const friendlyNames = {
                    trending: "🔥 Top Trending Hits",
                    sad: "💔 Sad Songs",
                    bollywood: "🇮🇳 Bollywood Melodies",
                    hollywood: "🇬🇧 Global Pop & Hits",
                    lofi: "☕ Lo-Fi & Chillwave",
                    pop: "🎵 Worldwide Chartbusters",
                    romantic: "💖 Romantic Resonance",
                    party: "🕺 High-Energy Party Mix"
                  };
                  
                  return (
                    <div key={key} className="category-section space-y-3">
                      {/* Section Header with Navigation Controls */}
                      <div className="flex justify-between items-center px-1">
                        <div className="flex items-center gap-3">
                          <h3 className="font-heading text-lg md:text-xl font-bold text-white tracking-tight">
                            {friendlyNames[key] || key}
                          </h3>
                          <span className="text-[10px] font-mono font-medium text-[#9999A6] bg-white/[0.04] border border-white/[0.08] px-2 py-0.5 rounded-full">
                            {songs.length} Tracks
                          </span>
                        </div>

                        {/* Scroll Navigation Arrows */}
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              const el = document.getElementById(`scroll-${key}`);
                              if (el) el.scrollBy({ left: -320, behavior: 'smooth' });
                            }}
                            className="p-1.5 rounded-full bg-[#191922] hover:bg-white/[0.08] text-[#9999A6] hover:text-white transition-all active:scale-90 cursor-pointer"
                            aria-label="Scroll left"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-3.5 h-3.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              const el = document.getElementById(`scroll-${key}`);
                              if (el) el.scrollBy({ left: 320, behavior: 'smooth' });
                            }}
                            className="p-1.5 rounded-full bg-[#191922] hover:bg-white/[0.08] text-[#9999A6] hover:text-white transition-all active:scale-90 cursor-pointer"
                            aria-label="Scroll right"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-3.5 h-3.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      
                      {/* Carousel Track Row */}
                      <div className="relative group/scroll">
                        <div 
                          id={`scroll-${key}`}
                          className="flex overflow-x-auto gap-3.5 pb-2 scroll-smooth hide-scrollbar px-1"
                        >
                          {songs.map((song) => {
                            const isCurrent = currentSong?.id === song.id;
                            const isFav = favorites.some(s => s.id === song.id);

                            return (
                              <div 
                                key={song.id} 
                                className="w-36 sm:w-44 flex-shrink-0 group cursor-pointer"
                                onClick={() => playSongFromList(song, songs)}
                              >
                                <div className={`relative aspect-square w-full rounded-2xl overflow-hidden bg-[#101017] border shadow-lg transition-all ${
                                  isCurrent 
                                    ? 'border-[#D5F36A] shadow-[0_0_18px_rgba(213,243,106,0.3)] ring-1 ring-[#D5F36A]' 
                                    : 'border-white/[0.08] group-hover:border-[#D5F36A]/50'
                                }`}>
                                  <img 
                                    src={song.thumbnailUrl} 
                                    alt={song.title} 
                                    loading="lazy"
                                    onError={(e) => {
                                      e.currentTarget.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop&q=80';
                                    }}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out" 
                                  />
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none" />

                                  {/* Duration Badge / Playing Equalizer Animation */}
                                  {isCurrent && isPlaying ? (
                                    <div className="absolute top-2 right-2 bg-black/85 backdrop-blur-md px-2 py-1 rounded-full flex items-center gap-1 border border-[#D5F36A]/40 shadow-sm pointer-events-none">
                                      <span className="eq-bar !h-3"></span>
                                      <span className="eq-bar !h-4"></span>
                                      <span className="eq-bar !h-2"></span>
                                    </div>
                                  ) : song.duration ? (
                                    <span className="absolute top-2 right-2 text-[10px] font-mono font-semibold bg-black/75 backdrop-blur-md px-1.5 py-0.5 rounded text-slate-300 pointer-events-none">
                                      {formatTime(song.duration)}
                                    </span>
                                  ) : null}

                                  {/* Quick Favorite Button */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleFavorite(song);
                                    }}
                                    className={`absolute top-2 left-2 p-1.5 rounded-full backdrop-blur-md transition-all cursor-pointer ${
                                      isFav ? 'bg-rose-500 text-white' : 'bg-black/60 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-white'
                                    }`}
                                    title={isFav ? "Remove from favorites" : "Add to favorites"}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={isFav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                                    </svg>
                                  </button>

                                  {/* Hover Play Button */}
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <div className="w-10 h-10 rounded-full bg-[#D5F36A] text-black flex items-center justify-center shadow-lg shadow-[#D5F36A]/30 transform scale-75 group-hover:scale-100 transition-transform active:scale-95">
                                      {isCurrent && isPlaying ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                                        </svg>
                                      ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 translate-x-0.5">
                                          <path d="M8 5v14l11-7z" />
                                        </svg>
                                      )}
                                    </div>
                                  </div>

                                  {/* Bottom Card Title and Artist */}
                                  <div className="absolute bottom-2.5 left-2.5 right-2.5">
                                    <p className="text-xs font-bold text-white truncate drop-shadow" title={song.title}>
                                      {song.title}
                                    </p>
                                    <p className="text-[10px] text-[#9999A6] font-medium truncate mt-0.5" title={song.artist}>
                                      {song.artist || 'Playback'}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'search' && (
          <div className="flex flex-col gap-8 max-w-5xl mx-auto w-full">
            {/* Search Header */}
            <div className="space-y-2">
              <h2 className="font-display text-3xl md:text-4xl font-extrabold text-[#F5F5F7] tracking-tight">
                Search Audio Catalog
              </h2>
              <p className="text-[#9999A6] text-sm">Instant access to millions of songs, mixes, and live recordings with zero quotas.</p>
            </div>

            {/* Search Input Bar */}
            <form onSubmit={handleSearchSubmit} className="relative flex items-center">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search songs, artists, albums, or paste YouTube links..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#101017] border border-white/[0.08] px-6 py-4 pl-14 pr-32 rounded-2xl text-[#F5F5F7] placeholder-[#666674] text-base shadow-2xl focus:outline-none focus:ring-2 focus:ring-[#D5F36A]/25 focus:border-[#D5F36A]/50 transition-all"
              />
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-5 h-5 text-[#9999A6] absolute left-5 top-1/2 -translate-y-1/2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>

              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="p-1.5 rounded-lg text-[#9999A6] hover:text-white hover:bg-white/[0.08]"
                    title="Clear"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
                <button
                  type="submit"
                  disabled={searchLoading || !searchQuery.trim()}
                  className="bg-[#D5F36A] hover:bg-[#BDE84A] text-black font-extrabold px-5 py-2 rounded-xl shadow-lg shadow-[#D5F36A]/20 active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none text-sm cursor-pointer"
                >
                  {searchLoading ? 'Searching...' : 'Search'}
                </button>
              </div>
            </form>

            {/* Quick Trending Search Tags */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-[#9999A6] uppercase tracking-wider">
                Trending Searches:
              </span>
              <div className="flex flex-wrap gap-2">
                {[
                  'Bollywood Hits',
                  'Sad Songs',
                  'Arijit Singh',
                  'Taylor Swift',
                  'The Weeknd',
                  'Lo-Fi Hindi Chill',
                  'Coldplay',
                  'Diljit Dosanjh',
                  'Coke Studio Hits',
                  'Acoustic Pop'
                ].map((tag) => (
                  <button
                    key={tag}
                    onClick={() => handleQuickTagClick(tag)}
                    className="px-3.5 py-1.5 rounded-full text-xs font-medium text-[#9999A6] hover:text-[#F5F5F7] bg-[#191922] hover:bg-white/[0.08] border border-white/[0.08] hover:border-[#D5F36A]/40 transition-all active:scale-95 cursor-pointer"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Results / Loading State */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <h3 className="font-heading text-lg font-bold text-[#F5F5F7] tracking-wide">
                  {searchResults.length > 0 ? `Results (${searchResults.length})` : 'Catalog Search'}
                </h3>
              </div>
              
              {searchLoading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-5">
                  <div className="w-12 h-12 border-3 border-white/10 border-t-[#D5F36A] rounded-full animate-spin"></div>
                  <p className="text-[#9999A6] text-sm font-medium">Scraping clean YouTube audio stream...</p>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="text-center py-20 bg-[#101017] rounded-3xl border border-white/[0.08] p-8">
                  <div className="w-16 h-16 rounded-2xl bg-[#191922] border border-white/[0.08] flex items-center justify-center mx-auto mb-4 text-[#D5F36A]">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-8 h-8">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 0v13.5m0-13.5L9 12.5m0 0v6.75m0-6.75L3 15.75M9 19.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm10.5-3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                    </svg>
                  </div>
                  <h4 className="text-white font-bold text-lg mb-1 font-heading">Discover New Sounds</h4>
                  <p className="text-[#9999A6] text-sm max-w-sm mx-auto">
                    Type a query or click any of the trending search tags above to discover and stream high-fidelity tracks.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-4">
                  {searchResults.map((song) => {
                    const isCurrent = currentSong?.id === song.id;
                    const isFav = favorites.some(s => s.id === song.id);

                    return (
                      <div 
                        key={song.id} 
                        onClick={() => playSongFromList(song, searchResults)}
                        className="group cursor-pointer"
                      >
                        <div className={`relative aspect-square w-full rounded-2xl overflow-hidden bg-[#101017] border shadow-lg transition-all ${
                          isCurrent 
                            ? 'border-[#D5F36A] shadow-[0_0_18px_rgba(213,243,106,0.3)] ring-1 ring-[#D5F36A]' 
                            : 'border-white/[0.08] group-hover:border-[#D5F36A]/50'
                        }`}>
                          <img 
                            src={song.thumbnailUrl} 
                            alt={song.title} 
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop&q=80';
                            }}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out" 
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none" />

                          {/* Duration Badge / Playing Equalizer Animation */}
                          {isCurrent && isPlaying ? (
                            <div className="absolute top-2 right-2 bg-black/85 backdrop-blur-md px-2 py-1 rounded-full flex items-center gap-1 border border-[#D5F36A]/40 shadow-sm pointer-events-none">
                              <span className="eq-bar !h-3"></span>
                              <span className="eq-bar !h-4"></span>
                              <span className="eq-bar !h-2"></span>
                            </div>
                          ) : song.duration ? (
                            <span className="absolute top-2 right-2 text-[10px] font-mono font-semibold bg-black/75 backdrop-blur-md px-1.5 py-0.5 rounded text-slate-300 pointer-events-none">
                              {formatTime(song.duration)}
                            </span>
                          ) : null}

                          {/* Quick Favorite Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(song);
                            }}
                            className={`absolute top-2 left-2 p-1.5 rounded-full backdrop-blur-md transition-all cursor-pointer ${
                              isFav ? 'bg-rose-500 text-white' : 'bg-black/60 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-white'
                            }`}
                            title={isFav ? "Remove from favorites" : "Add to favorites"}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={isFav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                            </svg>
                          </button>

                          {/* Hover Play Button */}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="w-10 h-10 rounded-full bg-[#D5F36A] text-black flex items-center justify-center shadow-lg shadow-[#D5F36A]/30 transform scale-75 group-hover:scale-100 transition-transform active:scale-95">
                              {isCurrent && isPlaying ? (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                                </svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 translate-x-0.5">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                              )}
                            </div>
                          </div>

                          {/* Bottom Card Title and Artist */}
                          <div className="absolute bottom-2.5 left-2.5 right-2.5">
                            <p className="text-xs font-bold text-white truncate drop-shadow" title={song.title}>
                              {song.title}
                            </p>
                            <p className="text-[10px] text-[#9999A6] font-medium truncate mt-0.5" title={song.artist}>
                              {song.artist || 'Playback'}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Active View: MY MUSIC / LIBRARY (Section 4 Redesign) */}
        {(activeTab === 'playlists' || activeTab === 'favorites') && (
          <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full">
            {activePlaylistId === null ? (
              <>
                {/* Header with Back, Centered Title, and New Playlist action */}
                <div className="flex items-center justify-between gap-4 pt-1">
                  <button
                    onClick={() => setActiveTab('home')}
                    className="w-10 h-10 rounded-full bg-[#191922] border border-white/[0.08] text-[#9999A6] hover:text-[#F5F5F7] hover:border-white/20 transition-all flex items-center justify-center flex-shrink-0 cursor-pointer"
                    title="Back to Home"
                    aria-label="Back to Home"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                    </svg>
                  </button>

                  <h2 className="font-display text-xl md:text-2xl font-extrabold text-[#F5F5F7] tracking-tight text-center">
                    My Music
                  </h2>

                  <button
                    onClick={openCreatePlaylistModal}
                    className="px-4 py-2 rounded-full bg-[#D5F36A] hover:bg-[#BDE84A] text-black font-extrabold text-xs shadow-md shadow-[#D5F36A]/20 active:scale-95 transition-all flex items-center gap-1.5 flex-shrink-0 cursor-pointer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    <span className="hidden sm:inline">New Playlist</span>
                  </button>
                </div>

                {/* Filter Tabs: Horizontally scrollable chips with lime-green active state */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'playlists', label: `Playlists (${playlists.length})` },
                    { id: 'liked', label: `Liked Songs (${favorites.length})` }
                  ].map((tab) => {
                    const isTabActive = libraryFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setLibraryFilter(tab.id);
                          if (tab.id === 'liked' && activeTab === 'playlists') {
                            setActiveTab('favorites');
                          } else if (tab.id !== 'liked' && activeTab === 'favorites') {
                            setActiveTab('playlists');
                          }
                        }}
                        className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex-shrink-0 ${
                          isTabActive
                            ? 'bg-[#D5F36A] text-black shadow-sm'
                            : 'bg-[#191922] text-[#9999A6] border border-white/[0.08] hover:text-[#F5F5F7] hover:border-white/20'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Content according to filter */}
                <div className="space-y-4">
                  {/* Liked Songs Featured Row (Shown in 'all' and 'liked') */}
                  {(libraryFilter === 'all' || libraryFilter === 'liked') && (
                    <div className="space-y-3">
                      {libraryFilter === 'all' && (
                        <div
                          onClick={() => {
                            if (favorites.length > 0) {
                              setLibraryFilter('liked');
                            }
                          }}
                          className="p-3.5 rounded-2xl bg-[#101017] border border-white/[0.08] hover:border-white/20 transition-all flex items-center justify-between gap-4 group cursor-pointer"
                        >
                          <div className="flex items-center gap-4 min-w-0 flex-1">
                            <div className="w-16 h-16 rounded-2xl overflow-hidden bg-gradient-to-tr from-rose-600/30 via-purple-600/20 to-[#191922] border border-white/[0.08] flex items-center justify-center flex-shrink-0 relative shadow-md">
                              {favorites.length > 0 ? (
                                <img src={favorites[0].thumbnailUrl} alt="Liked Songs" className="w-full h-full object-cover group-hover:scale-105 transition-transform opacity-75" />
                              ) : null}
                              <div className="absolute inset-0 flex items-center justify-center text-rose-400">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 drop-shadow">
                                  <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
                                </svg>
                              </div>
                            </div>

                            <div className="min-w-0 flex-1">
                              <h4 className="font-heading text-base font-bold text-[#F5F5F7] truncate group-hover:text-[#D5F36A] transition-colors">
                                Liked Songs
                              </h4>
                              <p className="text-xs text-[#9999A6] truncate mt-0.5">
                                Auto Playlist • By You
                              </p>
                              <span className="text-[11px] font-mono font-medium text-[#666674] mt-1 inline-block">
                                {favorites.length} {favorites.length === 1 ? 'Track' : 'Tracks'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            {favorites.length > 0 && (
                              <button
                                onClick={() => playSongFromList(favorites[0], favorites)}
                                className="w-10 h-10 rounded-full bg-[#D5F36A] hover:bg-[#BDE84A] text-black flex items-center justify-center shadow-md active:scale-90 transition-all cursor-pointer flex-shrink-0"
                                title="Play Liked Songs"
                                aria-label="Play Liked Songs"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 translate-x-0.5">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Full Liked Songs list when 'liked' filter is active */}
                      {libraryFilter === 'liked' && (
                        <div>
                          {favorites.length === 0 ? (
                            <div className="text-center py-20 bg-[#101017] rounded-3xl border border-white/[0.08] p-8">
                              <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto mb-3 text-rose-400">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-7 h-7">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                                </svg>
                              </div>
                              <h4 className="text-[#F5F5F7] font-bold text-base mb-1 font-heading">No Liked Songs Yet</h4>
                              <p className="text-[#9999A6] text-xs max-w-sm mx-auto">
                                Tap the heart on any song while listening to add it to your Liked Songs library.
                              </p>
                              <button
                                onClick={() => setActiveTab('home')}
                                className="mt-4 px-4 py-2 rounded-full bg-[#191922] hover:bg-white/[0.1] border border-white/[0.08] text-[#F5F5F7] text-xs font-semibold cursor-pointer"
                              >
                                Browse Discover
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between pb-2">
                                <span className="text-xs font-bold text-[#9999A6] uppercase tracking-wider font-mono">
                                  {favorites.length} {favorites.length === 1 ? 'Track' : 'Tracks'}
                                </span>
                                <button
                                  onClick={() => playSongFromList(favorites[0], favorites)}
                                  className="px-4 py-1.5 rounded-full bg-[#D5F36A] hover:bg-[#BDE84A] text-black font-extrabold text-xs shadow-md active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 translate-x-0.5">
                                    <path d="M8 5v14l11-7z" />
                                  </svg>
                                  <span>Play All</span>
                                </button>
                              </div>

                              {favorites.map((song) => {
                                const isCurrent = currentSong?.id === song.id;
                                return (
                                  <div
                                    key={song.id}
                                    onClick={() => playSongFromList(song, favorites)}
                                    className={`p-3 rounded-2xl bg-[#101017] border flex items-center justify-between gap-4 group cursor-pointer transition-all ${
                                      isCurrent ? 'border-[#D5F36A]/50 bg-[#191922]' : 'border-white/[0.08] hover:border-white/20'
                                    }`}
                                  >
                                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                                      <div className="w-14 h-14 rounded-xl overflow-hidden relative flex-shrink-0 bg-black/50 border border-white/[0.08]">
                                        <img src={song.thumbnailUrl} alt={song.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                        {isCurrent && isPlaying && (
                                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                            <span className="w-2 h-2 rounded-full bg-[#D5F36A] animate-ping"></span>
                                          </div>
                                        )}
                                      </div>

                                      <div className="min-w-0 flex-1">
                                        <h4 className="font-heading text-sm font-semibold text-[#F5F5F7] truncate group-hover:text-[#D5F36A] transition-colors">
                                          {song.title}
                                        </h4>
                                        <p className="text-xs text-[#9999A6] truncate mt-0.5">{song.artist}</p>
                                        <span className="text-[10px] font-mono font-medium text-[#666674] mt-1 inline-block">
                                          {formatTime(song.duration)}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                      <button
                                        onClick={() => toggleFavorite(song)}
                                        className="p-2 rounded-xl text-rose-500 hover:bg-white/[0.08] transition-colors cursor-pointer"
                                        title="Remove from Liked Songs"
                                        aria-label="Remove from Liked Songs"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                                          <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
                                        </svg>
                                      </button>

                                      <button
                                        onClick={() => setContextMenu({ isOpen: true, song })}
                                        className="p-2 rounded-xl text-[#9999A6] hover:text-[#F5F5F7] hover:bg-white/[0.08] transition-colors cursor-pointer"
                                        aria-label="Track options"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                                          <path d="M12 13a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM12 6a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM12 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Playlists List (Shown in 'all' and 'playlists') */}
                  {(libraryFilter === 'all' || libraryFilter === 'playlists') && (
                    <div className="space-y-3">
                      {playlists.length === 0 && libraryFilter === 'playlists' ? (
                        <div className="text-center py-20 bg-[#101017] rounded-3xl border border-white/[0.08] p-8">
                          <div className="w-14 h-14 rounded-2xl bg-[#D5F36A]/10 border border-[#D5F36A]/20 flex items-center justify-center mx-auto mb-3 text-[#D5F36A]">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-7 h-7">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                            </svg>
                          </div>
                          <h4 className="text-[#F5F5F7] font-bold text-base mb-1 font-heading">No Custom Playlists Yet</h4>
                          <p className="text-[#9999A6] text-xs max-w-sm mx-auto">
                            Create custom collections to group songs by artist, genre, workout or late night vibes.
                          </p>
                          <button
                            onClick={openCreatePlaylistModal}
                            className="mt-4 px-5 py-2 rounded-full bg-[#D5F36A] hover:bg-[#BDE84A] text-black font-extrabold text-xs shadow-md shadow-[#D5F36A]/20 cursor-pointer"
                          >
                            Create First Playlist
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {playlists.map((pl) => {
                            const trackCount = (pl.songs || []).length;
                            const coverImg = pl.songs && pl.songs.length > 0 ? pl.songs[0].thumbnailUrl : null;
                            return (
                              <div
                                key={pl.id}
                                onClick={() => setActivePlaylistId(pl.id)}
                                className="p-3.5 rounded-2xl bg-[#101017] border border-white/[0.08] hover:border-white/20 transition-all flex items-center justify-between gap-4 group cursor-pointer"
                              >
                                <div className="flex items-center gap-4 min-w-0 flex-1">
                                  <div className="w-16 h-16 rounded-2xl overflow-hidden bg-[#191922] border border-white/[0.08] flex items-center justify-center flex-shrink-0 relative shadow-md">
                                    {coverImg ? (
                                      <img src={coverImg} alt={pl.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                    ) : (
                                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-7 h-7 text-[#666674]">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                                      </svg>
                                    )}
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <h4 className="font-heading text-base font-bold text-[#F5F5F7] truncate group-hover:text-[#D5F36A] transition-colors">
                                      {pl.name}
                                    </h4>
                                    <p className="text-xs text-[#9999A6] truncate mt-0.5">
                                      Custom Playlist • By You
                                    </p>
                                    <span className="text-[11px] font-mono font-medium text-[#666674] mt-1 inline-block">
                                      {trackCount} {trackCount === 1 ? 'Track' : 'Tracks'}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  {trackCount > 0 && (
                                    <button
                                      onClick={() => playPlaylist(pl)}
                                      className="w-10 h-10 rounded-full bg-[#D5F36A] hover:bg-[#BDE84A] text-black flex items-center justify-center shadow-md active:scale-90 transition-all cursor-pointer flex-shrink-0"
                                      title="Play Playlist"
                                      aria-label={`Play ${pl.name}`}
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 translate-x-0.5">
                                        <path d="M8 5v14l11-7z" />
                                      </svg>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => deletePlaylist(pl.id)}
                                    className="p-2 rounded-xl text-[#9999A6] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                                    title="Delete Playlist"
                                    aria-label="Delete Playlist"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (() => {
              const currentPlaylist = playlists.find(p => p.id === activePlaylistId);
              if (!currentPlaylist) return null;

              return (
                <div className="space-y-6">
                  {/* Playlist Drilldown Header */}
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => setActivePlaylistId(null)}
                      className="w-10 h-10 rounded-full bg-[#191922] border border-white/[0.08] text-[#9999A6] hover:text-[#F5F5F7] hover:border-white/20 transition-all flex items-center justify-center cursor-pointer flex-shrink-0"
                      title="Back to Playlists"
                      aria-label="Back to Playlists"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                      </svg>
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] text-[#D5F36A] uppercase tracking-widest font-mono font-bold">Custom Playlist</span>
                      <h2 className="font-display text-2xl md:text-3xl font-extrabold text-[#F5F5F7] truncate">{currentPlaylist.name}</h2>
                      <p className="text-xs text-[#9999A6] mt-0.5">{(currentPlaylist.songs || []).length} Tracks saved</p>
                    </div>

                    <div className="flex items-center gap-2">
                      {currentPlaylist.songs && currentPlaylist.songs.length > 0 && (
                        <button
                          onClick={() => playPlaylist(currentPlaylist)}
                          className="px-5 py-2 rounded-full bg-[#D5F36A] hover:bg-[#BDE84A] text-black font-extrabold text-xs shadow-md shadow-[#D5F36A]/20 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 translate-x-0.5">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          <span>Play</span>
                        </button>
                      )}
                      <button
                        onClick={() => deletePlaylist(currentPlaylist.id)}
                        className="p-2 rounded-xl text-[#9999A6] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        title="Delete Playlist"
                        aria-label="Delete Playlist"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Playlist Songs */}
                  {(!currentPlaylist.songs || currentPlaylist.songs.length === 0) ? (
                    <div className="text-center py-16 bg-[#101017] rounded-3xl border border-white/[0.08] p-6">
                      <p className="text-[#9999A6] text-sm">This playlist is currently empty.</p>
                      <p className="text-[#666674] text-xs mt-1">Search songs and use the &apos;Add to Playlist&apos; option to populate it.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {currentPlaylist.songs.map((song, sIdx) => (
                        <div
                          key={`${song.id}-${sIdx}`}
                          className="bg-[#101017] border border-white/[0.08] hover:border-white/20 p-3 rounded-2xl flex items-center justify-between gap-4 group transition-all"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <span className="text-xs font-mono font-bold text-[#666674] w-5 text-center">
                              {sIdx + 1}
                            </span>
                            <div className="w-12 h-12 rounded-xl overflow-hidden bg-black/40 flex-shrink-0 border border-white/[0.08]">
                              <img src={song.thumbnailUrl} alt={song.title} className="w-full h-full object-cover" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h4 className="font-heading font-semibold text-[#F5F5F7] text-sm truncate group-hover:text-[#D5F36A] transition-colors">{song.title}</h4>
                              <p className="text-xs text-[#9999A6] truncate">{song.artist}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-[#666674] hidden sm:inline">
                              {formatTime(song.duration)}
                            </span>
                            <button
                              onClick={() => playSong(song)}
                              className="p-2 rounded-xl bg-[#D5F36A] text-black hover:bg-[#BDE84A] transition-colors cursor-pointer"
                              title="Play"
                              aria-label="Play song"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 translate-x-0.5">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => removeSongFromPlaylist(currentPlaylist.id, song.id)}
                              className="p-2 rounded-xl text-[#9999A6] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                              title="Remove"
                              aria-label="Remove from playlist"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Active View: MUSIC ROOMS */}
        {activeTab === 'rooms' && (
          <div className="flex flex-col gap-8 max-w-5xl mx-auto w-full">
            {!activeRoom ? (
              <>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="font-display text-3xl md:text-4xl font-extrabold text-[#F5F5F7] tracking-tight">
                      Collaborative Music Rooms
                    </h2>
                    <p className="text-[#9999A6] text-sm mt-1">Host or join synchronized listening sessions with friends in real-time.</p>
                  </div>

                  {/* Display Name Input */}
                  <div className="flex items-center gap-2 self-start md:self-auto bg-[#101017] px-3.5 py-2 rounded-2xl border border-white/[0.08]">
                    <span className="text-xs font-semibold text-[#9999A6] uppercase tracking-wider">Your Name:</span>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="bg-transparent text-sm text-[#D5F36A] font-bold focus:outline-none w-32 border-b border-white/[0.1] pb-0.5"
                    />
                  </div>
                </div>

                {roomError && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 px-4 py-3 rounded-2xl text-sm font-medium">
                    {roomError}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Create Room Card */}
                  <div className="bg-[#101017] rounded-3xl p-6 border border-white/[0.08] flex flex-col justify-between gap-4">
                    <div>
                      <div className="w-10 h-10 rounded-xl bg-[#D5F36A]/10 border border-[#D5F36A]/20 flex items-center justify-center text-[#D5F36A] mb-3">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                      </div>
                      <h3 className="font-heading text-lg font-bold text-[#F5F5F7]">Create Music Room</h3>
                      <p className="text-[#9999A6] text-xs mt-1">Host a session and control playback for all connected listeners.</p>
                    </div>

                    {!roomCreated ? (
                      <div className="space-y-4">
                        <div>
                          <label className="text-[10px] text-[#9999A6] uppercase tracking-widest font-bold">Room Name</label>
                          <input
                            type="text"
                            value={newRoomName}
                            onChange={(e) => setNewRoomName(e.target.value)}
                            placeholder="Late Night Beats, Chill Vibe"
                            className="w-full bg-[#191922] border border-white/[0.08] focus:border-[#D5F36A] text-[#F5F5F7] px-4 py-2.5 rounded-xl text-sm mt-1 focus:outline-none"
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <label className="text-[10px] text-[#9999A6] uppercase tracking-widest font-bold">Visibility</label>
                          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                            <button
                              onClick={() => setRoomVisibility('public')}
                              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${roomVisibility === 'public' ? 'bg-[#D5F36A] text-black font-extrabold' : 'text-[#9999A6] hover:text-[#F5F5F7]'}`}
                            >Public</button>
                            <button
                              onClick={() => setRoomVisibility('private')}
                              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${roomVisibility === 'private' ? 'bg-[#D5F36A] text-black font-extrabold' : 'text-[#9999A6] hover:text-[#F5F5F7]'}`}
                            >Private</button>
                          </div>
                        </div>

                        <button
                          onClick={handleCreateRoom}
                          disabled={!newRoomName.trim()}
                          className="w-full bg-[#D5F36A] hover:bg-[#BDE84A] text-black font-extrabold py-3 rounded-xl shadow-md shadow-[#D5F36A]/20 active:scale-[0.98] transition-all disabled:opacity-40 text-sm cursor-pointer"
                        >
                          Launch Room
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="p-4 rounded-2xl bg-[#D5F36A]/10 border border-[#D5F36A]/20 text-center">
                          <p className="text-[10px] text-[#D5F36A] uppercase tracking-widest font-bold">Your Room Code</p>
                          <p className="font-mono text-2xl font-black text-[#F5F5F7] mt-1 tracking-wider">{roomCode}</p>
                        </div>

                        <button
                          onClick={() => copyToClipboard(roomCode, 'code')}
                          className="w-full bg-[#191922] border border-white/[0.08] hover:border-white/20 text-[#F5F5F7] font-semibold py-2.5 rounded-xl text-xs cursor-pointer"
                        >
                          {copiedCode ? '✓ Copied Room Code' : 'Copy Room Code'}
                        </button>

                        <button
                          onClick={() => copyToClipboard(window.location.origin + '/room/' + roomCode, 'link')}
                          className="w-full bg-[#191922] border border-white/[0.08] hover:border-white/20 text-[#F5F5F7] font-semibold py-2.5 rounded-xl text-xs cursor-pointer"
                        >
                          {copiedLink ? '✓ Copied Invite Link' : 'Copy Invitation Link'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Join Room Card */}
                  <div className="bg-[#101017] rounded-3xl p-6 border border-white/[0.08] flex flex-col justify-between gap-4">
                    <div>
                      <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-3">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                        </svg>
                      </div>
                      <h3 className="font-heading text-lg font-bold text-[#F5F5F7]">Join by Code</h3>
                      <p className="text-[#9999A6] text-xs mt-1">Enter a unique room code from a friend to sync playback.</p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="text-[10px] text-[#9999A6] uppercase tracking-widest font-bold">Room Code</label>
                        <input
                          type="text"
                          value={joinRoomCode}
                          onChange={(e) => setJoinRoomCode(e.target.value.toUpperCase())}
                          placeholder="MZK-4839"
                          className="w-full bg-[#191922] border border-white/[0.08] focus:border-[#D5F36A] px-4 py-3 rounded-xl text-base font-mono font-bold text-center tracking-widest mt-1 text-[#F5F5F7] focus:outline-none"
                        />
                      </div>

                      <button
                        onClick={handleJoinRoom}
                        disabled={!joinRoomCode.trim()}
                        className="w-full bg-[#F5F5F7] hover:bg-white text-black font-extrabold py-3 rounded-xl shadow-md active:scale-[0.98] transition-all disabled:opacity-40 text-sm cursor-pointer"
                      >
                        Join Room
                      </button>
                    </div>
                  </div>

                  {/* Public Rooms List */}
                  <div className="bg-[#101017] rounded-3xl p-6 border border-white/[0.08] flex flex-col justify-between gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="w-10 h-10 rounded-xl bg-[#D5F36A]/10 border border-[#D5F36A]/20 flex items-center justify-center text-[#D5F36A]">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                          </svg>
                        </div>
                        <span className="text-[10px] font-mono text-[#D5F36A] font-bold bg-[#D5F36A]/10 border border-[#D5F36A]/20 px-2 py-0.5 rounded-full">
                          Live Network
                        </span>
                      </div>
                      <h3 className="font-heading text-lg font-bold text-[#F5F5F7]">Public Sessions</h3>
                      <p className="text-[#9999A6] text-xs mt-1">Drop into active rooms hosted across the network.</p>
                    </div>

                    {publicRooms.length === 0 ? (
                      <div className="py-8 text-center text-[#666674] text-xs">
                        No public sessions right now. Be the first to start one!
                      </div>
                    ) : (
                      <div className="space-y-2 overflow-y-auto max-h-48 custom-scrollbar">
                        {publicRooms.map((room) => (
                          <div key={room.code} className="p-3 rounded-2xl bg-[#191922] border border-white/[0.06] flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-[#F5F5F7] truncate">{room.name}</p>
                              <p className="text-[11px] text-[#9999A6] truncate">{room.listenerCount} listening · {room.host}</p>
                            </div>
                            <button
                              onClick={() => {
                                setJoinRoomCode(room.code);
                                socketRef.current?.emit('join_room_request', { roomCode: room.code, displayName });
                              }}
                              className="px-3.5 py-1.5 rounded-xl bg-[#D5F36A] text-black font-extrabold text-xs hover:bg-[#BDE84A] transition-colors cursor-pointer"
                            >
                              Join
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              /* Active Room Experience */
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 bg-[#101017] rounded-3xl border border-white/[0.08]">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="font-display text-2xl md:text-3xl font-extrabold text-[#F5F5F7]">{activeRoom.name}</h2>
                      <span className="bg-[#D5F36A]/10 text-[#D5F36A] text-xs px-2.5 py-1 rounded-full font-bold border border-[#D5F36A]/20 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#D5F36A] animate-pulse"></span>
                        LIVE SYNC
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-[#9999A6]">
                      <span className="font-mono bg-white/[0.06] px-2 py-0.5 rounded text-[#F5F5F7] font-bold">{roomCode}</span>
                      <span>{roomParticipants.length} Connected</span>
                      {isHost && <span className="text-[#D5F36A] font-semibold">★ Room Host</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copyToClipboard(roomCode, 'code')}
                      className="px-3 py-2 text-xs font-semibold text-[#F5F5F7] bg-[#191922] border border-white/[0.08] rounded-xl hover:border-white/20 transition-all cursor-pointer"
                    >
                      {copiedCode ? '✓ Copied' : 'Copy Code'}
                    </button>
                    <button
                      onClick={handleLeaveRoom}
                      className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-xl transition-all shadow-md shadow-rose-600/20 cursor-pointer"
                    >
                      Leave Room
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Current Synchronized Track */}
                  <div className="lg:col-span-2 bg-[#101017] rounded-3xl p-6 border border-white/[0.08]">
                    <span className="text-[10px] text-[#D5F36A] uppercase tracking-widest font-mono font-bold">Synchronized Playback</span>
                    {currentSong ? (
                      <div className="flex items-center gap-5 mt-4">
                        <img src={currentSong.thumbnailUrl} alt={currentSong.title} className="w-24 h-24 rounded-2xl object-cover border border-white/[0.08] shadow-md" />
                        <div className="flex-1 min-w-0">
                          <h4 className="font-heading text-lg font-bold text-[#F5F5F7] truncate">{currentSong.title}</h4>
                          <p className="text-xs text-[#9999A6] truncate mt-0.5">{currentSong.artist}</p>
                          <div className="flex items-center gap-2 mt-3">
                            <span className="w-1 h-3 rounded-full bg-[#D5F36A] animate-pulse"></span>
                            <span className="w-1 h-5 rounded-full bg-[#D5F36A] animate-pulse delay-75"></span>
                            <span className="w-1 h-2 rounded-full bg-[#D5F36A] animate-pulse delay-150"></span>
                            <span className="w-1 h-4 rounded-full bg-[#D5F36A] animate-pulse delay-100"></span>
                            <span className="text-xs text-[#D5F36A] font-semibold ml-2">
                              {isPlaying ? 'Playing to all listeners' : 'Paused'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center text-[#666674] text-sm">
                        Waiting for host to pick a track...
                      </div>
                    )}
                  </div>

                  {/* Connected Listeners */}
                  <div className="bg-[#101017] rounded-3xl p-6 border border-white/[0.08]">
                    <h3 className="font-heading text-sm font-bold text-[#F5F5F7] uppercase tracking-wider mb-3">
                      Listeners ({roomParticipants.length})
                    </h3>
                    <div className="space-y-2 overflow-y-auto max-h-48 custom-scrollbar">
                      {roomParticipants.map((p, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 rounded-xl bg-white/[0.02]">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-[#D5F36A]/20 border border-[#D5F36A]/30 flex items-center justify-center text-[#D5F36A] text-xs font-bold">
                              {p.displayName?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                            <span className="text-sm font-medium text-[#F5F5F7] truncate">{p.displayName}</span>
                          </div>
                          {p.isHost && (
                            <span className="text-[10px] bg-[#D5F36A]/10 text-[#D5F36A] border border-[#D5F36A]/20 px-2 py-0.5 rounded-full font-bold">
                              Host
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Activity Feed */}
                <div className="bg-[#101017] rounded-3xl p-6 border border-white/[0.08]">
                  <h3 className="font-heading text-sm font-bold text-[#F5F5F7] uppercase tracking-wider mb-3">Live Room Activity</h3>
                  {roomActivity.length === 0 ? (
                    <p className="text-[#666674] text-xs">Live events, joins, and track changes will appear here.</p>
                  ) : (
                    <div className="space-y-2 overflow-y-auto max-h-36 custom-scrollbar">
                      {roomActivity.slice().reverse().map((act, i) => (
                        <div key={i} className="flex items-center gap-3 text-xs text-[#9999A6] py-1 border-b border-white/[0.03]">
                          <span className="font-mono text-[#666674]">{new Date(act.timestamp).toLocaleTimeString()}</span>
                          <span className="text-[#F5F5F7]">{act.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Active View: QUEUE */}
        {activeTab === 'queue' && (() => {
          const currentIdx = queue.findIndex(s => s.id === currentSong?.id);
          const upcomingSongs = currentIdx !== -1 ? queue.slice(currentIdx + 1) : (queue.length > 0 && !currentSong ? queue : []);
          const historySongs = currentIdx > 0 ? queue.slice(0, currentIdx).reverse() : [];

          const onDragEnd = (result) => {
            if (!result.destination) return;
            const srcIndex = result.source.index;
            const destIndex = result.destination.index;
            if (srcIndex === destIndex) return;

            const upcomingStartIdx = currentIdx + 1;
            const newQueue = [...queue];
            const [removed] = newQueue.splice(upcomingStartIdx + srcIndex, 1);
            newQueue.splice(upcomingStartIdx + destIndex, 0, removed);
            setQueue(newQueue);
          };

          return (
            <div className="flex flex-col gap-8 max-w-5xl mx-auto w-full">
              <div className="flex justify-between items-end">
                <div>
                  <h2 className="font-display text-3xl md:text-4xl font-extrabold text-[#F5F5F7] tracking-tight">
                    Recently Played
                  </h2>
                  <p className="text-[#9999A6] text-sm mt-1">Your playback history, active session, and up next queue.</p>
                </div>
                {(queue.length > 0 || recentlyPlayed.length > 0) && (
                  <button
                    onClick={() => {
                      clearQueue();
                      setRecentlyPlayed([]);
                      localStorage.removeItem('listenup_recently_played');
                    }}
                    className="px-4 py-2 text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition-all cursor-pointer"
                  >
                    Clear History
                  </button>
                )}
              </div>

              {/* Now Playing Card */}
              {currentSong && (
                <div className="bg-[#101017] p-5 rounded-3xl border border-[#D5F36A]/30 flex items-center gap-5 relative shadow-md">
                  <div className="w-20 h-20 rounded-2xl overflow-hidden relative flex-shrink-0 bg-black/50 border border-white/[0.08]">
                    <img src={currentSong.thumbnailUrl} alt={currentSong.title} className="w-full h-full object-cover" />
                  </div>
                  
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] bg-[#D5F36A]/10 text-[#D5F36A] border border-[#D5F36A]/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider font-mono">
                      Now Playing
                    </span>
                    <h3 className="font-heading text-lg font-bold text-[#F5F5F7] truncate mt-2">{currentSong.title}</h3>
                    <p className="text-xs text-[#9999A6] truncate mt-0.5">{currentSong.artist}</p>
                  </div>

                  <div className="flex items-center gap-1 pr-2">
                    <span className="w-1 h-3 rounded-full bg-[#D5F36A] animate-pulse"></span>
                    <span className="w-1 h-5 rounded-full bg-[#D5F36A] animate-pulse delay-75"></span>
                    <span className="w-1 h-2 rounded-full bg-[#D5F36A] animate-pulse delay-150"></span>
                  </div>
                </div>
              )}

              {/* Up Next List */}
              <div className="space-y-4">
                <h3 className="font-heading text-lg font-bold text-[#F5F5F7] tracking-wide">Up Next ({upcomingSongs.length})</h3>
                {upcomingSongs.length === 0 ? (
                  <div className="text-center py-16 bg-[#101017] rounded-2xl border border-white/[0.08] p-6">
                    <p className="text-[#9999A6] text-sm">No songs queued up next.</p>
                    <p className="text-[#666674] text-xs mt-1">Play any track or add songs to queue to extend your session.</p>
                  </div>
                ) : (
                  <DragDropContext onDragEnd={onDragEnd}>
                    <Droppable droppableId="queue-upcoming">
                      {(provided) => (
                        <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                          {upcomingSongs.map((song, index) => (
                            <Draggable key={song.id} draggableId={`queue-${song.id}`} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  className={`flex items-center gap-3.5 p-3 rounded-2xl bg-[#101017] border transition-all ${
                                    snapshot.isDragging ? 'shadow-2xl shadow-[#D5F36A]/20 ring-1 ring-[#D5F36A]/30 bg-[#191922] border-[#D5F36A]/40' : 'border-white/[0.08]'
                                  }`}
                                >
                                  {/* Drag Handle */}
                                  <div {...provided.dragHandleProps} className="cursor-grab active:cursor-grabbing text-[#666674] hover:text-[#9999A6] px-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                                    </svg>
                                  </div>

                                  <span className="text-xs font-mono font-bold text-[#666674] w-4 text-center">
                                    {index + 1}
                                  </span>

                                  <div className="w-12 h-12 rounded-xl overflow-hidden relative flex-shrink-0 bg-black/40 border border-white/[0.08]">
                                    <img src={song.thumbnailUrl} alt={song.title} className="w-full h-full object-cover" />
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <h4 className="font-heading text-sm font-semibold truncate text-[#F5F5F7]">{song.title}</h4>
                                    <p className="text-xs text-[#9999A6] truncate mt-0.5">{song.artist}</p>
                                  </div>

                                  <span className="text-xs font-mono text-[#666674] hidden sm:inline">
                                    {formatTime(song.duration)}
                                  </span>

                                  <button
                                    onClick={() => removeFromQueue(song.id)}
                                    className="p-1.5 rounded-lg text-[#9999A6] hover:text-rose-400 hover:bg-rose-500/10 transition-all cursor-pointer"
                                    title="Remove from Queue"
                                    aria-label="Remove from Queue"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-4 h-4">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </DragDropContext>
                )}
              </div>

              {/* Listening History (All Recently Played Tracks) */}
              {recentlyPlayed.length > 0 && (
                <div className="space-y-4 pt-4 border-t border-white/[0.08]">
                  <div className="flex items-center justify-between">
                    <h3 className="font-heading text-lg font-bold text-[#F5F5F7] tracking-wide">
                      Recently Played History ({recentlyPlayed.length})
                    </h3>
                    <span className="text-xs text-[#9999A6]">Click any track to replay</span>
                  </div>

                  <div className="space-y-2">
                    {recentlyPlayed.map((song) => {
                      const isCurrent = currentSong?.id === song.id;
                      return (
                        <div
                          key={`recent-history-${song.id}`}
                          onClick={() => playSongFromList(song, recentlyPlayed)}
                          className={`flex items-center gap-3.5 p-3 rounded-2xl bg-[#101017] border transition-all cursor-pointer ${
                            isCurrent ? 'border-[#D5F36A]/50 bg-[#191922]' : 'border-white/[0.08] hover:border-white/20'
                          }`}
                        >
                          <div className="w-12 h-12 rounded-xl overflow-hidden relative flex-shrink-0 bg-black/40 border border-white/[0.08]">
                            <img src={song.thumbnailUrl} alt={song.title} className="w-full h-full object-cover" />
                            {isCurrent && isPlaying && (
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                <span className="w-2 h-2 rounded-full bg-[#D5F36A] animate-ping"></span>
                              </div>
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <h4 className="font-heading text-sm font-semibold truncate text-[#F5F5F7]">{song.title}</h4>
                            <p className="text-xs text-[#9999A6] truncate mt-0.5">{song.artist}</p>
                          </div>

                          {song.duration && (
                            <span className="text-xs font-mono text-[#666674] hidden sm:inline">
                              {formatTime(song.duration)}
                            </span>
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              playSongFromList(song, recentlyPlayed);
                            }}
                            className="p-2 rounded-full bg-white/[0.05] hover:bg-[#D5F36A] hover:text-black text-[#9999A6] transition-all cursor-pointer"
                            title="Play Track"
                            aria-label="Play Track"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 translate-x-0.5">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
          </>
        )}
      </main>
      </div>

      {/* Master Bottom Media Control Bar & Floating Mini-Player */}
      <footer className="w-full bg-transparent px-3 md:px-6 pb-2 pt-1 relative z-30 flex-shrink-0">
        {/* Floating Pill Container matching reference */}
        <div className="w-full max-w-5xl mx-auto rounded-2xl md:rounded-full bg-[#101017]/95 backdrop-blur-2xl border border-white/[0.08] shadow-[0_12px_40px_rgba(0,0,0,0.85)] p-2.5 md:px-5 md:py-3 flex items-center justify-between gap-3 transition-all hover:border-white/15">
          
          {/* Left: Active Track Details or Default Preview */}
          <div 
            className="flex items-center gap-3 min-w-0 flex-1 md:flex-initial md:w-1/3 cursor-pointer group"
            onClick={() => setIsNowPlayingOpen(true)}
            title="Open Now Playing"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsNowPlayingOpen(true); }}
          >
            <div ref={playerArtRef} className="w-11 h-11 md:w-12 md:h-12 rounded-xl overflow-hidden bg-black/60 border border-white/[0.08] shadow-md flex-shrink-0 relative">
              <img 
                src={currentSong ? currentSong.thumbnailUrl : (homeData.trending?.[0]?.thumbnailUrl || 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=120&auto=format&fit=crop&q=80')} 
                alt={currentSong ? currentSong.title : (homeData.trending?.[0]?.title || 'ListenUp Music')} 
                className="w-full h-full object-cover group-hover:scale-105 transition-transform" 
              />
              {isPlaying && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center pointer-events-none">
                  <span className="w-2 h-2 rounded-full bg-[#D5F36A] animate-ping"></span>
                </div>
              )}
            </div>
            <div ref={playerTitleRef} className="min-w-0 flex-1">
              <h4 className="font-heading text-xs md:text-sm font-bold text-[#F5F5F7] truncate group-hover:text-[#D5F36A] transition-colors" title={currentSong ? currentSong.title : (homeData.trending?.[0]?.title || 'ListenUp Music')}>
                {currentSong ? currentSong.title : (homeData.trending?.[0]?.title || 'ListenUp Music')}
              </h4>
              <p className="text-[10px] md:text-xs text-[#9999A6] truncate mt-0.5" title={currentSong ? currentSong.artist : (homeData.trending?.[0]?.artist || 'Ready to Stream')}>
                {currentSong ? currentSong.artist : (homeData.trending?.[0]?.artist || 'Ready to Stream')}
              </p>
            </div>
          </div>

          {/* Center: Playback Progress (Desktop) */}
          <div className="hidden md:flex flex-1 items-center gap-3 max-w-sm px-2">
            <span className="text-[10px] font-mono text-[#9999A6] w-8 text-right select-none">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={handleSeekChange}
              disabled={!currentSong || !isPlayerReady}
              className="flex-1 accent-[#D5F36A] h-1 rounded-full cursor-pointer disabled:opacity-30"
            />
            <span className="text-[10px] font-mono text-[#9999A6] w-8 select-none">
              {formatTime(duration)}
            </span>
          </div>

          {/* Right: Controls matching reference (Heart, Lime-Green Play/Pause, Next) + Volume */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Heart / Favorite Button */}
            <button
              onClick={() => {
                if (currentSong) toggleFavorite(currentSong);
                else playFeaturedMix();
              }}
              aria-label={currentSong && favorites.some(s => s.id === currentSong.id) ? "Remove from favorites" : "Add to favorites"}
              className={`p-2 rounded-full hover:bg-white/[0.08] transition-colors cursor-pointer ${
                currentSong && favorites.some(s => s.id === currentSong.id) ? 'text-rose-500' : 'text-[#9999A6] hover:text-[#F5F5F7]'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill={currentSong && favorites.some(s => s.id === currentSong.id) ? 'currentColor' : 'none'} viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
            </button>

            {/* Play/Pause Button - Lime-Green Circle matching reference */}
            <button
              onClick={() => {
                if (!currentSong) {
                  playFeaturedMix();
                  return;
                }
                if (activeRoom && !isHost && socketRef.current) {
                  socketRef.current.emit('request_playback', { isPlaying: !isPlaying, displayName });
                  return;
                }
                setIsPlaying(!isPlaying);
              }}
              className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-[#D5F36A] hover:bg-[#BDE84A] text-black flex items-center justify-center shadow-[0_0_20px_rgba(213,243,106,0.35)] active:scale-90 transition-all flex-shrink-0 cursor-pointer"
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isBuffering ? (
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
              ) : isPlaying ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 translate-x-0.5">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Next Button */}
            <button
              onClick={playNext}
              disabled={queue.length === 0}
              className="p-2 text-[#9999A6] hover:text-[#F5F5F7] transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title="Next Track"
              aria-label="Next Track"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
              </svg>
            </button>

            {/* Desktop Volume Slider */}
            <div className="hidden lg:flex items-center gap-2 pl-2 border-l border-white/[0.08]">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="text-[#9999A6] hover:text-[#F5F5F7] transition-colors cursor-pointer"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-4 h-4 text-rose-500">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6L4.5 9H1.5v6h3l4.5 3.75V5.25z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                )}
              </button>

              <input
                type="range"
                min="0"
                max="100"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  setVolume(parseInt(e.target.value, 10));
                  setIsMuted(false);
                }}
                className="w-18 accent-[#D5F36A] h-1 rounded-full cursor-pointer"
              />
            </div>

            {/* Expand Fullscreen Player Button */}
            <button
              onClick={() => setIsNowPlayingOpen(true)}
              className="p-2 rounded-full hover:bg-white/[0.08] text-[#9999A6] hover:text-[#D5F36A] active:scale-90 transition-all cursor-pointer"
              title="Open Now Playing Screen"
              aria-label="Open Now Playing Screen"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            </button>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Navigation Dock: Home, Browse, Library, Rooms, Profile */}
      <nav className="md:hidden w-full h-16 bg-[#08080D]/95 backdrop-blur-xl border-t border-white/[0.08] flex justify-around items-center px-2 pb-[env(safe-area-inset-bottom)] relative z-30 flex-shrink-0">
        {[
          {
            id: 'home',
            label: 'Home',
            icon: (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-8.689-8.69a2.25 2.25 0 00-3.182 0l-8.69 8.69a.75.75 0 001.061 1.06l8.69-8.69z" />
                <path d="M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625a1.875 1.875 0 01-1.875-1.875v-6.198a2.29 2.29 0 00.091-.086L12 5.432z" />
              </svg>
            )
          },
          {
            id: 'search',
            label: 'Browse',
            icon: (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 7.5l-3 6.5-6.5 3 3-6.5 6.5-3z" />
              </svg>
            )
          },
          {
            id: 'playlists',
            label: 'Library',
            icon: (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
              </svg>
            )
          },
          {
            id: 'rooms',
            label: 'Rooms',
            icon: (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            ),
            badge: activeRoom ? 'LIVE' : null
          },
          {
            id: 'profile',
            label: 'Profile',
            icon: user && profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="Profile" className="w-5 h-5 rounded-full object-cover" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            )
          }
        ].map((item) => {
          const isActive = (item.id === 'home' && activeTab === 'home') ||
                           (item.id === 'search' && activeTab === 'search') ||
                           (item.id === 'playlists' && (activeTab === 'playlists' || activeTab === 'favorites')) ||
                           (item.id === 'rooms' && activeTab === 'rooms') ||
                           (item.id === 'profile' && isProfileModalOpen);
          return (
            <button
              key={item.id}
              onClick={() => {
                if (item.id === 'profile') {
                  if (user) {
                    setIsProfileModalOpen(true);
                  } else {
                    setAuthModalMode('signin');
                    setIsAuthModalOpen(true);
                  }
                  return;
                }
                setActiveTab(item.id);
                if (item.id === 'playlists') setActivePlaylistId(null);
              }}
              className={`flex flex-col items-center justify-center gap-1 py-1 transition-all flex-1 cursor-pointer relative ${
                isActive ? 'text-[#D5F36A] font-extrabold' : 'text-[#9999A6] hover:text-[#F5F5F7]'
              }`}
            >
              <div className={`relative ${isActive ? 'drop-shadow-[0_0_8px_rgba(213,243,106,0.5)]' : ''}`}>
                {item.icon}
                {item.badge && (
                  <span className="absolute -top-1 -right-2 text-[8px] font-bold bg-[#D5F36A] text-black px-1 rounded-full leading-tight animate-pulse">
                    {item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] tracking-tight">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Create Playlist Modal */}
      <dialog
        ref={createPlaylistDialogRef}
        className="dialog-reset rounded-3xl p-6 bg-[#191922] border border-white/[0.08] text-[#F5F5F7] w-84 shadow-2xl relative select-text"
        closedby="any"
      >
        <form onSubmit={handleCreatePlaylistSubmit} className="flex flex-col gap-4">
          <h3 className="font-heading text-lg font-bold text-[#F5F5F7]">Create New Playlist</h3>
          <p className="text-xs text-[#9999A6]">Give your collection a memorable name.</p>
          <input
            type="text"
            required
            placeholder="e.g. Midnight Lo-Fi, Cardio Push"
            value={newPlaylistName}
            onChange={(e) => setNewPlaylistName(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl bg-[#101017] border border-white/[0.08] focus:border-[#D5F36A] text-[#F5F5F7] text-sm focus:outline-none"
          />
          <div className="flex gap-2 justify-end mt-2">
            <button
              type="button"
              onClick={closeCreatePlaylistModal}
              className="px-4 py-2 text-xs font-semibold text-[#9999A6] hover:text-[#F5F5F7] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-extrabold bg-[#D5F36A] hover:bg-[#BDE84A] text-black rounded-xl shadow-md shadow-[#D5F36A]/20 cursor-pointer"
            >
              Create
            </button>
          </div>
        </form>
      </dialog>

      {/* Global Context Menu Sheet */}
      {contextMenu.isOpen && contextMenu.song && (
        <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center pointer-events-auto">
          <div 
            className="absolute inset-0 bg-black/75 backdrop-blur-md transition-opacity" 
            onClick={() => setContextMenu({ isOpen: false, song: null })}
          ></div>
          
          <div className="relative w-full md:max-w-sm bg-[#191922] rounded-t-3xl md:rounded-3xl shadow-2xl overflow-hidden border border-white/[0.08] pb-[env(safe-area-inset-bottom)]">
            <div className="p-4 border-b border-white/[0.06] flex items-center gap-3.5 bg-white/[0.02]">
              <img src={contextMenu.song.thumbnailUrl} alt={contextMenu.song.title} className="w-12 h-12 rounded-xl object-cover shadow border border-white/[0.08]" />
              <div className="flex-1 min-w-0">
                <h3 className="font-heading text-[#F5F5F7] font-bold truncate text-sm">{contextMenu.song.title}</h3>
                <p className="text-[#9999A6] text-xs truncate">{contextMenu.song.artist}</p>
              </div>
            </div>

            <div className="py-2 flex flex-col">
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(`https://listen-up-lilac.vercel.app/search?q=${encodeURIComponent(contextMenu.song.title)}`);
                  setContextMenu({ isOpen: false, song: null });
                }}
                className="w-full text-left px-5 py-3.5 text-[#F5F5F7] hover:bg-white/[0.06] transition-colors flex items-center gap-3.5 text-sm cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5 text-[#9999A6]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                </svg>
                <span>Share Track Link</span>
              </button>
              
              <button 
                onClick={() => {
                  toggleFavorite(contextMenu.song);
                  setContextMenu({ isOpen: false, song: null });
                }}
                className="w-full text-left px-5 py-3.5 text-[#F5F5F7] hover:bg-white/[0.06] transition-colors flex items-center gap-3.5 text-sm cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5 text-[#9999A6]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                </svg>
                <span>Toggle Favorite</span>
              </button>

              <button 
                onClick={() => {
                  appendToQueue(contextMenu.song);
                  setContextMenu({ isOpen: false, song: null });
                }}
                className="w-full text-left px-5 py-3.5 text-[#F5F5F7] hover:bg-white/[0.06] transition-colors flex items-center gap-3.5 text-sm cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5 text-[#9999A6]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                </svg>
                <span>Add to Queue</span>
              </button>
              
              <div className="mt-2 pt-2 border-t border-white/[0.06]">
                <div className="px-5 py-2 text-[10px] font-bold text-[#9999A6] uppercase tracking-widest font-mono">Add to Playlist</div>
                {playlists.length === 0 ? (
                  <div className="px-5 py-2 text-xs text-[#666674] italic">No playlists created yet.</div>
                ) : (
                  <div className="max-h-40 overflow-y-auto custom-scrollbar">
                    {playlists.map((pl) => (
                      <button 
                        key={pl.id}
                        onClick={() => {
                          addSongToPlaylist(pl.id, contextMenu.song);
                          setContextMenu({ isOpen: false, song: null });
                        }}
                        className="w-full text-left px-5 py-2.5 text-[#9999A6] hover:text-[#D5F36A] hover:bg-white/[0.06] transition-colors flex items-center gap-3 text-xs cursor-pointer"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-4 h-4 text-[#9999A6]">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19.5h12m-12-3h12m-12-3h12m-12-3h12M5.625 19.5a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm0-7.5a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm0-7.5a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0z" />
                        </svg>
                        <span className="truncate">{pl.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              
              <button 
                onClick={() => setContextMenu({ isOpen: false, song: null })}
                className="w-full mt-2 py-3 text-center text-xs font-semibold text-[#9999A6] hover:text-[#F5F5F7] border-t border-white/[0.06] cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Song Request Notifications (Host Only) */}
      {pendingSongRequests.length > 0 && isHost && (
        <div className="fixed bottom-24 right-6 z-50 flex flex-col gap-3 max-w-sm w-full">
          {pendingSongRequests.map((req) => (
            <div key={req.id} className="bg-[#191922] border border-[#D5F36A]/30 rounded-2xl p-4 shadow-2xl">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-[#D5F36A] animate-ping"></span>
                <span className="text-xs text-[#D5F36A] font-bold uppercase tracking-wider font-mono">Incoming Song Request</span>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <img
                  src={req.song.thumbnailUrl}
                  alt={req.song.title}
                  className="w-12 h-12 rounded-xl object-cover border border-white/[0.08]"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[#F5F5F7] truncate font-heading">{req.song.title}</p>
                  <p className="text-xs text-[#9999A6] truncate">Requested by <span className="text-[#D5F36A] font-semibold">{req.requestedBy}</span></p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleAcceptSongRequest(req)}
                  className="flex-1 px-3 py-2 text-xs font-extrabold text-black bg-[#D5F36A] hover:bg-[#BDE84A] rounded-xl transition-all cursor-pointer"
                >
                  ✓ Accept
                </button>
                <button
                  onClick={() => handleDeclineSongRequest(req)}
                  className="flex-1 px-3 py-2 text-xs font-semibold text-[#F5F5F7] bg-white/[0.06] hover:bg-white/[0.12] rounded-xl transition-all cursor-pointer"
                >
                  ✕ Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Premium Now Playing Fullscreen Screen with Animated Circular Visualizer */}
      <NowPlayingScreen
        isOpen={isNowPlayingOpen}
        onClose={() => setIsNowPlayingOpen(false)}
        currentSong={currentSong}
        isPlaying={isPlaying}
        isBuffering={isBuffering}
        currentTime={currentTime}
        duration={duration}
        onPlayPause={() => {
          if (!currentSong) {
            playFeaturedMix();
            return;
          }
          if (activeRoom && !isHost && socketRef.current) {
            socketRef.current.emit('request_playback', { isPlaying: !isPlaying, displayName });
            return;
          }
          setIsPlaying(!isPlaying);
        }}
        onPrevious={playPrevious}
        onNext={playNext}
        onSeek={handleSeekChange}
        formatTime={formatTime}
        shuffle={shuffle}
        onToggleShuffle={handleShuffleToggle}
        repeat={repeat}
        onToggleRepeat={toggleRepeat}
        favorites={favorites}
        onToggleFavorite={toggleFavorite}
        queue={queue}
        onPlayFromQueue={(song) => playSong(song)}
        activeRoom={activeRoom}
        volume={volume}
        isMuted={isMuted}
        onVolumeChange={(val) => {
          setVolume(val);
          if (playerRef.current && playerRef.current.setVolume) {
            playerRef.current.setVolume(val);
          }
        }}
        onToggleMute={() => setIsMuted(!isMuted)}
      />

      {/* Supabase Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        initialMode={authModalMode}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* User Profile & Music Preferences Settings Modal */}
      <ProfileSettingsModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />

      {/* Guest Favorites and Playlists Migration Modal */}
      <GuestMigrationModal
        isOpen={isGuestMigrationOpen}
        guestFavoritesCount={(favorites || []).length}
        guestPlaylistsCount={(playlists || []).length}
        onConfirmMerge={async () => {
          await migrateGuestData(favorites, playlists);
          setIsGuestMigrationOpen(false);
        }}
        onSkip={() => setIsGuestMigrationOpen(false)}
      />
    </div>
  );
}
