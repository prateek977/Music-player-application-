package com.listenup.app.search;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native Android Song Search & Category Browse Plugin.
 *
 * Executes YouTube InnerTube queries directly on the Android background thread
 * with zero dependency on Python/Flask or any external server.
 * Implements in-memory caching and offline fallback.
 */
@CapacitorPlugin(name = "ListenUpSearch")
public class ListenUpSearchPlugin extends Plugin {
    private static final String TAG = "ListenUpSearch";
    private static final String INNERTUBE_API = "https://www.youtube.com/youtubei/v1/search";

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // In-memory cache for search & browse: query -> CacheEntry
    private static class CacheEntry {
        final JSArray results;
        final long timestamp;
        CacheEntry(JSArray results) {
            this.results = results;
            this.timestamp = System.currentTimeMillis();
        }
    }
    private static final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();
    private static final long CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

    private static final Map<String, String> BROWSE_CATEGORIES = new HashMap<>();
    static {
        BROWSE_CATEGORIES.put("trending", "latest trending hit songs india official music video");
        BROWSE_CATEGORIES.put("sad", "sad emotional heartbreak songs hindi official video");
        BROWSE_CATEGORIES.put("bollywood", "latest bollywood songs official video");
        BROWSE_CATEGORIES.put("hollywood", "popular english songs official video");
        BROWSE_CATEGORIES.put("lofi", "lofi chill single track hindi");
        BROWSE_CATEGORIES.put("pop", "top pop songs india official music video");
        BROWSE_CATEGORIES.put("romantic", "romantic songs hindi official video");
        BROWSE_CATEGORIES.put("party", "party dance songs hindi official video");
    }

    @PluginMethod
    public void searchYouTube(PluginCall call) {
        String query = call.getString("query", "").trim();
        int limit = call.getInt("limit", 20);

        if (query.isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("results", new JSArray());
            call.resolve(ret);
            return;
        }

        // Check in-memory cache first
        String cacheKey = "search:" + query.toLowerCase();
        CacheEntry cached = cache.get(cacheKey);
        if (cached != null && (System.currentTimeMillis() - cached.timestamp < CACHE_TTL_MS)) {
            Log.d(TAG, "Returning cached search results for: " + query);
            JSObject ret = new JSObject();
            ret.put("results", cached.results);
            ret.put("cached", true);
            call.resolve(ret);
            return;
        }

        executor.execute(() -> {
            try {
                JSArray results = performInnerTubeSearch(query, limit);

                if (results.length() > 0) {
                    cache.put(cacheKey, new CacheEntry(results));
                }

                mainHandler.post(() -> {
                    JSObject ret = new JSObject();
                    ret.put("results", results);
                    ret.put("cached", false);
                    call.resolve(ret);
                });
            } catch (Exception e) {
                Log.e(TAG, "Search error for query '" + query + "': " + e.getMessage(), e);

                // If network failed but we have any older cached entry, return it gracefully
                if (cached != null) {
                    mainHandler.post(() -> {
                        JSObject ret = new JSObject();
                        ret.put("results", cached.results);
                        ret.put("cached", true);
                        ret.put("offlineFallback", true);
                        call.resolve(ret);
                    });
                } else {
                    mainHandler.post(() -> call.reject("Failed to search YouTube: " + e.getMessage()));
                }
            }
        });
    }

    @PluginMethod
    public void browseCategory(PluginCall call) {
        String category = call.getString("category", "trending").toLowerCase().trim();
        String query = BROWSE_CATEGORIES.get(category);
        if (query == null) {
            query = category + " songs official video";
        }

        String cacheKey = "browse:" + category;
        CacheEntry cached = cache.get(cacheKey);
        if (cached != null && (System.currentTimeMillis() - cached.timestamp < CACHE_TTL_MS)) {
            Log.d(TAG, "Returning cached browse results for: " + category);
            JSObject ret = new JSObject();
            ret.put("results", cached.results);
            ret.put("category", category);
            ret.put("cached", true);
            call.resolve(ret);
            return;
        }

        final String finalQuery = query;
        executor.execute(() -> {
            try {
                JSArray results = performInnerTubeSearch(finalQuery, 25);

                if (results.length() > 0) {
                    cache.put(cacheKey, new CacheEntry(results));
                }

                mainHandler.post(() -> {
                    JSObject ret = new JSObject();
                    ret.put("results", results);
                    ret.put("category", category);
                    ret.put("cached", false);
                    call.resolve(ret);
                });
            } catch (Exception e) {
                Log.e(TAG, "Browse error for category '" + category + "': " + e.getMessage(), e);
                if (cached != null) {
                    mainHandler.post(() -> {
                        JSObject ret = new JSObject();
                        ret.put("results", cached.results);
                        ret.put("category", category);
                        ret.put("cached", true);
                        ret.put("offlineFallback", true);
                        call.resolve(ret);
                    });
                } else {
                    mainHandler.post(() -> call.reject("Failed to browse category: " + e.getMessage()));
                }
            }
        });
    }

    /**
     * Executes YouTube's InnerTube client API to retrieve video search results.
     */
    private JSArray performInnerTubeSearch(String query, int limit) throws Exception {
        URL url = new URL(INNERTUBE_API);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
        conn.setConnectTimeout(6000);
        conn.setReadTimeout(8000);
        conn.setDoOutput(true);

        JSONObject contextObj = new JSONObject();
        JSONObject clientObj = new JSONObject();
        clientObj.put("clientName", "WEB");
        clientObj.put("clientVersion", "2.20240101.00.00");
        contextObj.put("client", clientObj);

        JSONObject payload = new JSONObject();
        payload.put("context", contextObj);
        payload.put("query", query);

        byte[] postData = payload.toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(postData);
            os.flush();
        }

        int statusCode = conn.getResponseCode();
        if (statusCode != 200) {
            throw new Exception("InnerTube HTTP error code: " + statusCode);
        }

        StringBuilder response = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                response.append(line);
            }
        }

        return parseInnerTubeResponse(response.toString(), limit);
    }

    /**
     * Parses the InnerTube JSON response into ListenUp's standardized track format:
     * [{ id, title, artist, thumbnailUrl, duration, viewCount }]
     */
    private JSArray parseInnerTubeResponse(String jsonString, int limit) {
        JSArray results = new JSArray();
        try {
            JSONObject root = new JSONObject(jsonString);
            JSONObject contents = root.optJSONObject("contents");
            if (contents == null) return results;

            JSONObject twoCol = contents.optJSONObject("twoColumnSearchResultsRenderer");
            if (twoCol == null) return results;

            JSONObject primary = twoCol.optJSONObject("primaryContents");
            if (primary == null) return results;

            JSONObject sectionList = primary.optJSONObject("sectionListRenderer");
            if (sectionList == null) return results;

            JSONArray sectionContents = sectionList.optJSONArray("contents");
            if (sectionContents == null) return results;

            for (int i = 0; i < sectionContents.length(); i++) {
                JSONObject section = sectionContents.optJSONObject(i);
                if (section == null) continue;

                JSONObject itemSection = section.optJSONObject("itemSectionRenderer");
                if (itemSection == null) continue;

                JSONArray items = itemSection.optJSONArray("contents");
                if (items == null) continue;

                for (int j = 0; j < items.length(); j++) {
                    JSONObject item = items.optJSONObject(j);
                    if (item == null) continue;

                    JSONObject video = item.optJSONObject("videoRenderer");
                    if (video == null) continue;

                    String videoId = video.optString("videoId");
                    if (videoId.isEmpty()) continue;

                    // Title
                    String title = "Unknown Title";
                    JSONObject titleObj = video.optJSONObject("title");
                    if (titleObj != null) {
                        JSONArray runs = titleObj.optJSONArray("runs");
                        if (runs != null && runs.length() > 0) {
                            title = runs.optJSONObject(0).optString("text", title);
                        } else {
                            title = titleObj.optString("simpleText", title);
                        }
                    }

                    // Artist / Channel Name
                    String artist = "Unknown Artist";
                    JSONObject ownerObj = video.optJSONObject("ownerText");
                    if (ownerObj != null) {
                        JSONArray runs = ownerObj.optJSONArray("runs");
                        if (runs != null && runs.length() > 0) {
                            artist = runs.optJSONObject(0).optString("text", artist);
                        }
                    }
                    if ("Unknown Artist".equals(artist)) {
                        JSONObject bylineObj = video.optJSONObject("longBylineText");
                        if (bylineObj != null) {
                            JSONArray runs = bylineObj.optJSONArray("runs");
                            if (runs != null && runs.length() > 0) {
                                artist = runs.optJSONObject(0).optString("text", artist);
                            }
                        }
                    }

                    // Duration
                    int durationSeconds = 0;
                    JSONObject lengthObj = video.optJSONObject("lengthText");
                    if (lengthObj != null) {
                        String lengthStr = lengthObj.optString("simpleText", "");
                        durationSeconds = parseDurationString(lengthStr);
                    }

                    // Filter out shorts (< 60s) or ultra-long sets (> 600s / 10m)
                    if (durationSeconds > 0 && (durationSeconds < 60 || durationSeconds > 600)) {
                        continue;
                    }

                    // Thumbnail
                    String thumbnail = "https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg";
                    JSONObject thumbObj = video.optJSONObject("thumbnail");
                    if (thumbObj != null) {
                        JSONArray thumbs = thumbObj.optJSONArray("thumbnails");
                        if (thumbs != null && thumbs.length() > 0) {
                            thumbnail = thumbs.optJSONObject(thumbs.length() - 1).optString("url", thumbnail);
                        }
                    }

                    // View count
                    String viewCount = "";
                    JSONObject viewsObj = video.optJSONObject("viewCountText");
                    if (viewsObj != null) {
                        viewCount = viewsObj.optString("simpleText", "");
                    }

                    JSObject song = new JSObject();
                    song.put("id", videoId);
                    song.put("title", title);
                    song.put("artist", artist);
                    song.put("thumbnailUrl", thumbnail);
                    song.put("duration", durationSeconds);
                    song.put("viewCount", viewCount);
                    song.put("playbackType", "youtube");
                    song.put("isDirectStream", false);
                    song.put("isPreview", false);
                    song.put("isFullLength", true);

                    results.put(song);
                    if (results.length() >= limit) {
                        return results;
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error parsing InnerTube JSON: " + e.getMessage(), e);
        }
        return results;
    }

    /**
     * Parses duration strings like "3:45" or "1:02:15" into seconds.
     */
    private int parseDurationString(String str) {
        if (str == null || str.isEmpty()) return 0;
        try {
            String[] parts = str.split(":");
            if (parts.length == 2) {
                int min = Integer.parseInt(parts[0].trim());
                int sec = Integer.parseInt(parts[1].trim());
                return (min * 60) + sec;
            } else if (parts.length == 3) {
                int hr = Integer.parseInt(parts[0].trim());
                int min = Integer.parseInt(parts[1].trim());
                int sec = Integer.parseInt(parts[2].trim());
                return (hr * 3600) + (min * 60) + sec;
            }
        } catch (Exception ignored) {}
        return 0;
    }
}

