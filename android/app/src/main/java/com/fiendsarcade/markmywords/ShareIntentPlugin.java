package com.fiendsarcade.markmywords;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * The share target's native half.
 *
 * The share-sheet intent lands on MainActivity itself (see the manifest), so
 * this reads that activity's current intent and hands the web side what it
 * carried: the text, and for a picture the bytes themselves as base64. The
 * bytes cross the bridge here rather than as a path because the content://
 * URI a share carries is only readable while the receiving activity holds
 * the grant, and a path handed to another plugin later may not be.
 *
 * This replaced the send-intent package, whose read used the activity's
 * launch intent (stale once the app was already open, so a share into a
 * running app did nothing) and whose finish() closed the hosting activity,
 * which here is the whole app.
 */
@CapacitorPlugin(name = "ShareIntent")
public class ShareIntentPlugin extends Plugin {

    /** Fired on window when a share arrives while the app is already open. */
    static final String EVENT = "shareReceived";

    @PluginMethod
    public void read(PluginCall call) {
        JSObject ret = new JSObject();
        Intent intent = getActivity().getIntent();
        if (!isShare(intent)) {
            ret.put("received", false);
            call.resolve(ret);
            return;
        }

        String type = intent.getType();
        ret.put("received", true);
        ret.put("type", type);
        putIfPresent(ret, "title", intent.getStringExtra(Intent.EXTRA_SUBJECT));
        putIfPresent(ret, "text", intent.getStringExtra(Intent.EXTRA_TEXT));

        if (type.startsWith("image/")) {
            Uri uri = streamUri(intent);
            if (uri == null) {
                ret.put("error", "The share named a picture but carried no file.");
            } else {
                try {
                    ret.put("imageData", readBase64(uri));
                    String resolved = getContext().getContentResolver().getType(uri);
                    ret.put("imageType", resolved != null ? resolved : type);
                } catch (IOException | SecurityException e) {
                    ret.put("error", "Could not read the shared picture: " + e.getMessage());
                }
            }
        }

        call.resolve(ret);
    }

    /**
     * Forget the share once the web side has taken it, so a WebView reload
     * does not deliver the same picture a second time.
     */
    @PluginMethod
    public void consume(PluginCall call) {
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        call.resolve();
    }

    static boolean isShare(Intent intent) {
        if (intent == null || intent.getType() == null) return false;
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return false;
        // Reopening the app from Recents redelivers the intent that started
        // the task. A share handled an hour ago is not a new share.
        return (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0;
    }

    private static void putIfPresent(JSObject target, String key, String value) {
        if (value != null) target.put(key, value);
    }

    private static Uri streamUri(Intent intent) {
        ClipData clip = intent.getClipData();
        if (clip != null && clip.getItemCount() > 0) {
            Uri uri = clip.getItemAt(0).getUri();
            if (uri != null) return uri;
        }
        Object extra = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return extra instanceof Uri ? (Uri) extra : null;
    }

    private String readBase64(Uri uri) throws IOException {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("no stream for " + uri);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        }
    }
}
