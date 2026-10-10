# Locked In - Focus & App Blocker

A Windows productivity application that helps you stay focused by blocking distracting applications during work sessions.

## Features

- **Focus Sessions**: Selected apps are the primary session apps and are launched or activated at startup; allowed apps are optional apps the user may switch to during the session
- **Application Blocking**: Block distracting applications during focus sessions
- **Smart Monitoring**: Automatic detection of foreground applications
- **Focus Modes**: Aggressive closes unauthorized foreground apps and restores focus; Moderate asks before temporarily allowing an unlisted app for the session; Lenient tracks activity without blocking. Explicitly blocked apps cannot be approved during a session.
- **Blocked Apps**: Explicitly blocked applications remain inaccessible in Aggressive and Moderate modes
- **Session Analytics**: Detailed reports on focused time, distractions, and blocked attempts
- **Deep App Discovery**: Comprehensive scanning of installed applications
- **Windows Integration**: Native Windows experience with proper installation

## Installation

1. Download the latest installer from the releases page
2. Run the installer and follow the setup wizard
3. Launch Locked In from your Start Menu or Desktop shortcut

## Building from Source

```bash
# Install dependencies
npm install

# Run in development mode
npm start

# Build for Windows
npm run build-win

# Create distribution package
npm run dist