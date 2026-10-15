# Security

SignalPilot is a **local, single-user** app. Please keep it that way unless you add your own authentication.

## Your API keys
- Keys entered on the **Setup** page are stored in `data/app.db` on your machine. Keys in `.env.local` override them.
- Both `data/` and `.env*` (except `.env.example`) are gitignored. Never commit them, and never paste keys into issues or pull requests.
- If a key leaks, rotate it at the provider (Meta Model API, Max, Overloop) and paste the new one on the Setup page.

## Exposing the app (webhooks)
Max webhooks need a public URL, usually a tunnel such as `cloudflared tunnel --url http://localhost:3000`. A tunnel makes the **whole UI** reachable, so:
1. Set `APP_PASSWORD` in `.env.local` **before** starting the tunnel. Every page except `/api/webhooks/*` then requires it.
2. Set a webhook secret. The webhook rejects unsigned requests and refuses to run without one.

## Safety switches
- Sending is **off** by default. Nothing is created in Overloop and no email goes out until you turn sending on in Setup (typed confirmation). `SP_SENDING_ENABLED=0` in `.env.local` forces it off.
- Lead websites are fetched server-side with private and loopback addresses blocked.
- Lead data and web pages are passed to Muse Wonder as untrusted input.

## Reporting a vulnerability
Please open a private security advisory on the GitHub repository rather than a public issue.
