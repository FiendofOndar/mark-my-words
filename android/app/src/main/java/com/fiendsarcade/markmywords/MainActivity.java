package com.fiendsarcade.markmywords;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareIntentPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * A share into an app that is already open arrives here, not through
     * onCreate, and Android leaves getIntent() pointing at whatever launched
     * the activity. Capacitor does not update it either. So: make the new
     * intent the current one, and tell the web side to look.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent == null) return;
        setIntent(intent);
        if (ShareIntentPlugin.isShare(intent) && bridge != null) {
            bridge.triggerWindowJSEvent(ShareIntentPlugin.EVENT);
        }
    }
}
