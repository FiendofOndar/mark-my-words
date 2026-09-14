import { registerPlugin } from '@capacitor/core';

/**
 * What the native side read off the share-sheet intent. Native only: the
 * Java half lives in android/app/src/main/java/.../ShareIntentPlugin.java,
 * and there is no web implementation, so call it behind isNative().
 */
export interface ShareIntentResult {
  /** False when the activity's current intent is not a share. */
  received: boolean;
  /** The intent's MIME type: text/plain, image/png, image/* and so on. */
  type?: string;
  /** EXTRA_SUBJECT, when the sender set one (browsers send the page title). */
  title?: string;
  /** EXTRA_TEXT: the words, or a link, or both in one string. */
  text?: string;
  /** The picture's bytes, base64 without a data: prefix. */
  imageData?: string;
  /** The picture's type as the content provider reports it. */
  imageType?: string;
  /** Why a picture the share named could not be read. */
  error?: string;
}

export interface ShareIntentPlugin {
  read(): Promise<ShareIntentResult>;
  /** Forget the share so a WebView reload does not deliver it again. */
  consume(): Promise<void>;
}

export const ShareIntent = registerPlugin<ShareIntentPlugin>('ShareIntent');

/** Fired on window by MainActivity when a share lands in a running app. */
export const SHARE_RECEIVED_EVENT = 'shareReceived';
