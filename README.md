# PEPSCam OBS Cam Monitor

Static GitHub Pages version of an OBS camera monitor/sender workflow.

## Files

- `index.html` redirects to the control panel.
- `OBSCam/OBSCamMonitor.html` is the control panel and OBS browser-source receiver.
- `OBSCam/OBSCamPhone.html` is the phone sender page.
- `OBSCam/pepscam.css`, `OBSCam/monitor.js`, and `OBSCam/phone.js` contain the app styling and logic.

## How To Use

1. Open `OBSCam/OBSCamMonitor.html`.
2. Start or rejoin a room.
3. Open `GET OBS LINKS` and add each camera link as an OBS Browser Source.
4. Scan the phone QR code from `Scan to Connect`, choose a camera slot, and start streaming.

For the OBS auto-add button, enable OBS WebSocket:

- OBS `Tools` -> `WebSocket Server Settings`
- Port `4455`
- No password

## Notes

This implementation is written as new PEPSCam code. It uses PeerJS public signaling for WebRTC room discovery, so it does not use the original site's Firebase project. Media still flows peer-to-peer through WebRTC wherever the network allows it.
