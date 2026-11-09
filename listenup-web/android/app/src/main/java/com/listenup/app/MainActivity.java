package com.listenup.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.listenup.app.data.local.ListenUpStoragePlugin;
import com.listenup.app.playback.ListenUpMediaPlugin;
import com.listenup.app.search.ListenUpSearchPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ListenUpMediaPlugin.class);
        registerPlugin(ListenUpStoragePlugin.class);
        registerPlugin(ListenUpSearchPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
