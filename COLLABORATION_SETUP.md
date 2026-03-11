# Collaboration Setup Guide

This Strategy Map now supports real-time collaboration! Multiple users can work on the same map simultaneously.

## Quick Start (Demo Mode)

The app includes a demo Firebase configuration. To test collaboration:

1. Open the app in your browser
2. Click the **Share** button in the top-left
3. Copy the link and share with others
4. Anyone with the link can join and collaborate in real-time

> **Note:** The demo configuration may have limited capacity. For production use, set up your own Firebase project.

## Setting Up Your Own Firebase Project

For a production deployment, create your own Firebase project:

### Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" and follow the setup wizard
3. Name your project (e.g., "my-strategy-map")

### Step 2: Enable Realtime Database

1. In your Firebase project, go to **Build** → **Realtime Database**
2. Click "Create Database"
3. Choose your region
4. Start in **test mode** for development (you can secure it later)

### Step 3: Get Your Configuration

1. Go to **Project Settings** (gear icon)
2. Scroll down to "Your apps" and click the web icon (`</>`)
3. Register your app and copy the configuration object

### Step 4: Update the App

Open `app.js` and find the `FIREBASE_CONFIG` object near the top of the file. Replace it with your configuration:

```javascript
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### Step 5: Secure Your Database (Production)

For production, update your Realtime Database rules:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true,
        "canvasState": {
          ".validate": "newData.hasChildren(['objects', 'timestamp', 'lastUpdatedBy'])"
        }
      }
    }
  }
}
```

## Features

### What Gets Synced

- ✅ Drawings (pen strokes, arrows)
- ✅ Champion markers
- ✅ Minion markers
- ✅ Ward markers
- ✅ Tower destroyed states
- ✅ Objective (Baron/Elder) states
- ✅ Object positions when moved

### What's Local Only

- ⚪ Zoom level
- ⚪ Pan position
- ⚪ Tower/Monster visibility toggles
- ⚪ Right panel state

## Troubleshooting

### "Offline" Status

- Check your internet connection
- Verify Firebase configuration is correct
- Check browser console for errors

### Changes Not Syncing

- Ensure all users have the same room ID in the URL
- Check Firebase Realtime Database rules allow read/write
- Look for errors in the browser console

### Multiple Users Editing Same Object

The last edit wins. For best results, coordinate who's editing what.

## Usage Tips

1. **Create a new room** for each game/strategy session
2. **Share the exact URL** - the room ID is in the `?room=` parameter
3. **Use different marker colors** for different players/phases
4. **Click towers** to mark them as destroyed - this syncs too!
