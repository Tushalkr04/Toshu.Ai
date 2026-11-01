# Toshu — Neon Gemini Chatbot

A mini-project chatbot with a responsive chat interface and Google's Gemini API. The Gemini API key stays on the local server and is never sent to the browser.

## Get started

1. Install [Node.js](https://nodejs.org/) 18 or newer.
2. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).
3. If `.env` is missing, the app creates one from `.env.example` automatically on startup.
4. Open `.env` and replace `your_gemini_api_key_here` with your key. Keep the key private; `.env` is excluded from Git.
5. Double-click `start-chatbot.bat` to start the server and open Toshu in your browser. You can also start it from PowerShell:

   ```powershell
   npm start
   ```

6. If you started it from PowerShell, visit [http://localhost:3000](http://localhost:3000).

   To bind the app to a different address or port, set `HOST` and `PORT` in `.env` before restarting the server.

To use a different Gemini model or port, change `GEMINI_MODEL` or `PORT` in `.env`, then restart the server. The app prefers supported Gemini 3.x models and will try compatible fallbacks if an older model is retired. Chat history stays in the current browser tab and is sent to Gemini for context.
