const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

app.use(express.json());

// Change these before deployment.
// Set them as private environment variables on Render.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ROOM_SECRET = process.env.ROOM_SECRET;

if (!ADMIN_PASSWORD || !ROOM_SECRET) {
    console.error("Missing ADMIN_PASSWORD or ROOM_SECRET environment variables.");
    process.exit(1);
}

const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_ORIGIN || "https://your-site.onrender.com",
        methods: ["GET", "POST"]
    }
});

app.get("/", (req, res) => {
    res.send("Birthday Live Camera Server is Running!");
});

// Admin login
app.post("/api/admin-login", (req, res) => {
    const { password } = req.body || {};

    if (
        typeof password !== "string" ||
        password.length > 200 ||
        !crypto.timingSafeEqual(
            Buffer.from(
                crypto.createHash("sha256").update(password).digest()
            ),
            Buffer.from(
                crypto.createHash("sha256").update(ADMIN_PASSWORD).digest()
            )
        )
    ) {
        return res.status(401).json({ success: false });
    }

    const token = crypto.randomBytes(32).toString("hex");

    adminTokens.set(token, Date.now());

    res.json({ success: true, token });
});

const adminTokens = new Map();
const connectedUsers = new Map();

function isAdmin(token) {
    const createdAt = adminTokens.get(token);

    if (!createdAt) return false;

    // Session expires after 2 hours
    if (Date.now() - createdAt > 2 * 60 * 60 * 1000) {
        adminTokens.delete(token);
        return false;
    }

    return true;
}

io.use((socket, next) => {
    const { roomSecret, role, adminToken } = socket.handshake.auth || {};

    if (role === "admin" && isAdmin(adminToken)) {
        socket.data.role = "admin";
        socket.data.room = "birthday-private-room";
        return next();
    }

    if (role === "friend" && roomSecret === ROOM_SECRET) {
        socket.data.role = "friend";
        socket.data.room = "birthday-private-room";
        return next();
    }

    next(new Error("Unauthorized connection"));
});

io.on("connection", (socket) => {
    const room = socket.data.room;
    const role = socket.data.role;

    socket.join(room);

    connectedUsers.set(socket.id, role);

    console.log(`${role} connected`);

    socket.to(room).emit("user-joined", { role });

    socket.on("offer", (offer) => {
        if (role !== "friend") return;
        socket.to(room).emit("offer", offer);
    });

    socket.on("answer", (answer) => {
        if (role !== "admin") return;
        socket.to(room).emit("answer", answer);
    });

    socket.on("ice-candidate", (candidate) => {
        if (
            !candidate ||
            typeof candidate !== "object" ||
            !["friend", "admin"].includes(role)
        ) return;

        socket.to(room).emit("ice-candidate", candidate);
    });

    socket.on("disconnect", () => {
        connectedUsers.delete(socket.id);
        console.log(`${role} disconnected`);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});