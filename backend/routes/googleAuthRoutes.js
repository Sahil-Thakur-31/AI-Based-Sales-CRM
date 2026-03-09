const express = require("express");
const router = express.Router();
const axios = require("axios");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/users");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:8080/auth/google/callback";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// Inline middleware: accepts token from Authorization header OR ?token= query param
// (query param needed because browser redirects can't carry headers)
function verifyToken(req, res, next) {
    const headerToken = req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.split(" ")[1]
        : null;
    const token = headerToken || req.query.token;

    if (!token) return res.status(401).json({ message: "No token provided" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = { _id: decoded._id, email: decoded.email, role: decoded.role };
        next();
    } catch {
        return res.status(401).json({ message: "Invalid token" });
    }
}

const { refreshGoogleAccessToken, normalizeSyncItem, upsertGoogleCalendarItem } = require("../services/googleCalendarSync");

router.get("/", verifyToken, (req, res) => {
    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_REDIRECT_URI,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/calendar",
        access_type: "offline",
        prompt: "consent",
        // Pass the user's ID as state so we know who to save the tokens for
        state: String(req.user._id),
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// GET /auth/google/callback
// Google redirects here with ?code=XXXX&state=userId
router.get("/callback", async (req, res) => {
    const { code, state: userId, error } = req.query;

    if (error || !code || !userId) {
        return res.redirect(`${FRONTEND_URL}/calendar?googleCalendar=error`);
    }

    try {
        // Exchange code for tokens
        const tokenRes = await axios.post("https://oauth2.googleapis.com/token", {
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: GOOGLE_REDIRECT_URI,
            grant_type: "authorization_code",
        });

        const { access_token, refresh_token } = tokenRes.data;

        // Save tokens to the user record
        await User.updateOne(
            { _id: userId },
            {
                $set: {
                    "googleCalendar.accessToken": access_token,
                    "googleCalendar.connectedAt": new Date(),
                    ...(refresh_token && { "googleCalendar.refreshToken": refresh_token }),
                },
            }
        );

        console.log(`[GoogleAuth] Connected Google Calendar for user ${userId}`);

        // Do not bulk-sync existing meetings on connect.
        // Meetings are synced only when a followup/meeting is created or edited.

        // Redirect back to frontend calendar page with success flag
        res.redirect(`${FRONTEND_URL}/calendar?googleCalendar=connected`);
    } catch (err) {
        console.error("[GoogleAuth] Token exchange error:", err?.response?.data || err?.message);
        res.redirect(`${FRONTEND_URL}/calendar?googleCalendar=error`);
    }
});

// GET /auth/google/status — check if current user has connected Google Calendar
router.get("/status", verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select("googleCalendar").lean();
        const connected = !!(user?.googleCalendar?.accessToken);
        res.json({
            connected,
            connectedAt: user?.googleCalendar?.connectedAt || null,
        });
    } catch (err) {
        console.error("[GoogleAuth] Status check error:", err);
        res.status(500).json({ connected: false });
    }
});

// DELETE /auth/google/disconnect — revoke and remove tokens
router.delete("/disconnect", verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select("googleCalendar").lean();
        const token = user?.googleCalendar?.accessToken;

        if (token) {
            // Attempt to revoke the token with Google
            await axios.post(`https://oauth2.googleapis.com/revoke?token=${token}`).catch(() => { });
        }

        await User.updateOne(
            { _id: req.user._id },
            { $set: { "googleCalendar.accessToken": null, "googleCalendar.refreshToken": null, "googleCalendar.connectedAt": null } }
        );

        res.json({ disconnected: true });
    } catch (err) {
        console.error("[GoogleAuth] Disconnect error:", err);
        res.status(500).json({ message: "Failed to disconnect" });
    }
});

// POST /auth/google/sync-visible
// Sync currently visible CRM calendar items to connected Google Calendar.
router.post("/sync-visible", verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select("googleCalendar").lean();
        const accessToken = user?.googleCalendar?.accessToken;
        if (!accessToken) {
            return res.status(400).json({ message: "Google Calendar not connected" });
        }

        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        const items = rawItems.map(normalizeSyncItem).filter(Boolean).slice(0, 500);

        require('fs').writeFileSync('sync_debug.json', JSON.stringify({
            receivedCount: rawItems.length,
            passingNormalize: items.map(i => ({ title: i.title, start: i.start }))
        }, null, 2));

        let tokenToUse = accessToken;
        const results = [];

        for (const item of items) {
            try {
                const out = await upsertGoogleCalendarItem({
                    accessToken: tokenToUse,
                    userId: req.user._id,
                    item,
                });
                results.push({ id: item.itemId, type: item.type, ok: !!out?.ok, mode: out?.mode || null });
            } catch (err) {
                if (err?.response?.status === 401) {
                    const refreshToken = user?.googleCalendar?.refreshToken;
                    const refreshed = await refreshGoogleAccessToken(req.user._id, refreshToken);
                    if (!refreshed) {
                        results.push({ id: item.itemId, type: item.type, ok: false, reason: "auth_expired" });
                        continue;
                    }
                    tokenToUse = refreshed;
                    try {
                        const retryOut = await upsertGoogleCalendarItem({
                            accessToken: tokenToUse,
                            userId: req.user._id,
                            item,
                        });
                        results.push({ id: item.itemId, type: item.type, ok: !!retryOut?.ok, mode: retryOut?.mode || null });
                    } catch (retryErr) {
                        results.push({
                            id: item.itemId,
                            type: item.type,
                            ok: false,
                            reason: retryErr?.response?.data?.error?.message || retryErr?.message || "sync_failed",
                        });
                    }
                } else {
                    results.push({
                        id: item.itemId,
                        type: item.type,
                        ok: false,
                        reason: err?.response?.data?.error?.message || err?.message || "sync_failed",
                    });
                }
            }
        }

        const synced = results.filter((r) => r.ok).length;
        const failed = results.length - synced;
        return res.status(200).json({ synced, failed, total: results.length, results });
    } catch (err) {
        console.error("[GoogleAuth] sync-visible error:", err?.response?.data || err?.message);
        return res.status(500).json({ message: "Failed to sync visible calendar to Google" });
    }
});

module.exports = router;
