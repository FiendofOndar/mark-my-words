import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fiendsarcade.markmywords',
  appName: 'Mark My Words',
  webDir: 'dist',
  android: {
    // The ledger is local; nothing needs to be reachable over plain HTTP.
    allowMixedContent: false,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#C9A227',
    },
    CapacitorSQLite: {
      androidIsEncryption: false,
    },
  },
};

export default config;
