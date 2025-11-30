require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const cors = require("cors");
const http = require("http");
const FormData = require("form-data");
const axios = require("axios");

// ---------- IMPORT USER MODEL ----------
const User = require("./models/User"); // <-- THIS LINE WAS MISSING

const app = express();
const PORT = process.env.PORT || 3001; // you changed to 3001

// ---------- CORS ----------
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        "http://localhost:3000",
        "https://umnpaperanalyzer.netlify.app",
      ];

      // Allow any Netlify subdomain (main + preview deploys)
      if (
        origin.startsWith("http://localhost:") ||
        (origin.startsWith("https://") &&
          origin.endsWith(".netlify.app") &&
          origin.includes("umnpaperanalyzer"))
      ) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// ---------- BODY PARSERS ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- MONGO ----------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected → paper_editor.users"))
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });

// ---------- TEST ----------
app.get("/test", (req, res) => {
  res.json({ message: "Hello! Server is working!" });
});

// ---------- SIGNUP ----------
app.post("/api/signup", async (req, res) => {
  const { email, firstName, lastName, password } = req.body;

  console.log("Signup →", { email, firstName, lastName });

  if (!email || !firstName || !lastName || !password) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    if (await User.findOne({ email })) {
      return res.status(400).json({ message: "Email already in use" });
    }

    const hashed = await bcrypt.hash(password, 10);
    await User.create({ email, firstName, lastName, password: hashed });

    res.status(201).json({ message: "User created successfully" });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- LOGIN ----------
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  try {
    // ---- HARD-CODED DEV LOGIN ----
    if (process.env.NODE_ENV === "development") {
      if (email === "admin@test.com" && password === "123456") {
        const devToken = jwt.sign({ id: "dev-user" }, process.env.JWT_SECRET, {
          expiresIn: "1h",
        });
        return res.json({ token: devToken, dev: true });
      }
    }
    // ---- END DEV LOGIN ----

    // ORIGINAL CODE BELOW
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    res.json({ token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- JWT MIDDLEWARE ----------
const verifyToken = (req, res, next) => {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.split(" ")[1] : null;
  if (!token) return res.status(401).json({ message: "No token" });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid token" });
    req.user = decoded;
    next();
  });
};

// ---------- UPLOAD PROXY ----------
// ---------- UPLOAD PROXY (FIXED) ----------
const upload = multer();

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  const edit_mode = req.body.edit_mode || "minimal";

  if (!file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const form = new FormData();
  form.append("file", file.buffer, {
    filename: file.originalname,
    contentType: file.mimetype || "application/pdf",
  });
  form.append("edit_mode", edit_mode);

  try {
    const response = await axios.post(
      `${
        process.env.PYTHON_API_URL || "https://analyzer-script-4ohb.vercel.app/"
      }/upload`,
      form,
      {
        headers: form.getHeaders(),
        timeout: 180000,
      }
    );

    // Python now returns JSON → we forward it directly
    res.json(response.data);
  } catch (err) {
    console.error("Python API failed:", err.response?.data || err.message);
    res.status(500).json({
      message: "AI processing failed",
      error: err.response?.data || err.message,
    });
  }
});

// ———————— CHAT ENDPOINT (POLLING) — WORKS ON VERCEL ————————
app.post("/api/chat", verifyToken, async (req, res) => {
  const { session_id, message } = req.body;

  if (!session_id || !message) {
    return res.status(400).json({ error: "session_id and message required" });
  }

  try {
    const response = await axios.post(
      `${
        process.env.PYTHON_API_URL || "https://analyzer-script-4ohb.vercel.app"
      }/chat`,
      { session_id, message },
      { headers: { "Content-Type": "application/json" }, timeout: 90000 }
    );

    res.json({ answer: response.data.answer });
  } catch (err) {
    console.error("Chat error:", err.response?.data || err.message);
    res.status(500).json({ error: "AI response failed" });
  }
});

// ---------- START SERVER ----------
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server RUNNING → http://localhost:${PORT}`);
  console.log(`Test → curl http://localhost:${PORT}/test`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} in use! Kill it:`);
    console.error(
      `lsof -i :${PORT} | grep LISTEN | awk '{print $2}' | xargs kill -9`
    );
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});
