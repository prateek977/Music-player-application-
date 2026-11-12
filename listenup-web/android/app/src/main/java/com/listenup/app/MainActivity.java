package com.listenup.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.listenup.app.data.local.ListenUpStoragePlugin;
import com.listenup.app.playback.ListenUpMediaPlugin;
import com.listenup.app.search.ListenUpSearchPlugin;

public class MainActivity extends BridgeActivity {
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ListenUpMediaPlugin.class);
        registerPlugin(ListenUpStoragePlugin.class);
        registerPlugin(ListenUpSearchPlugin.class);
        super.onCreate(savedInstanceState);

        android.webkit.WebView.setWebContentsDebuggingEnabled(true);

        // Request POST_NOTIFICATIONS runtime permission on Android 13+ (API 33+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST_CODE);
            }
        }
    }
}
