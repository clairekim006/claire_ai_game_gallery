# Color Caper WebSocket Backend

GitHub Pages can host the Color Caper frontend, but it cannot run the multiplayer WebSocket server. Deploy this folder to a backend host such as Render, Railway, or Fly.io, then update the frontend URL.

## Files

- `server.js`: WebSocket room server for Color Caper.
- `package.json`: Node scripts and dependencies.

## Local Test

```sh
npm install
npm run dev
```

For local frontend testing only, temporarily set `COLOR_CAPER_WS_URL` in `games/color-caper/script.js` to:

```js
const COLOR_CAPER_WS_URL = 'ws://localhost:4191';
```

Before publishing to GitHub Pages, change it back to your deployed secure URL:

```js
const COLOR_CAPER_WS_URL = 'wss://your-deployed-server.example.com';
```

## Deploy To Render

1. Push this repository to GitHub.
2. In Render, create a new Web Service from the repository.
3. Set the root directory to `backend/color-caper-server`.
4. Use `npm install` as the build command.
5. Use `npm start` as the start command.
6. Render provides a public HTTPS URL. Use the matching WSS URL in the frontend, for example:

```js
const COLOR_CAPER_WS_URL = 'wss://color-caper-server.onrender.com';
```

Optional environment variable:

```text
ALLOWED_ORIGINS=https://your-github-username.github.io
```

## Deploy To Railway

1. Create a new Railway project from the GitHub repository.
2. Set the service root directory to `backend/color-caper-server`.
3. Railway should detect Node automatically.
4. Set the start command to `npm start` if Railway asks.
5. Generate or use the public Railway domain.
6. Put the secure WebSocket URL in the frontend:

```js
const COLOR_CAPER_WS_URL = 'wss://your-service.up.railway.app';
```

## Deploy To Fly.io

1. Install and log in to the Fly.io CLI.
2. From this folder, run:

```sh
fly launch
fly deploy
```

3. Use the generated app URL as a WSS endpoint:

```js
const COLOR_CAPER_WS_URL = 'wss://your-fly-app.fly.dev';
```

## Frontend Change

The GitHub Pages frontend is in:

```text
games/color-caper/script.js
```

Replace this placeholder:

```js
const COLOR_CAPER_WS_URL = 'wss://my-deployed-server.com';
```

with your deployed backend URL.
