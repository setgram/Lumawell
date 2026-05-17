import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const dataDir = join(root, "data");
const postsFile = join(dataDir, "posts.json");
const adminFile = join(dataDir, "admin.json");
const sessions = new Map();

function loadEnvFile() {
  const envFile = join(root, ".env");
  if (!existsSync(envFile)) return;

  const lines = readFileSync(envFile, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
    }
  }
}

loadEnvFile();

const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || "lumawell";
const mongoCollectionName = process.env.MONGODB_COLLECTION || "posts";
let postsCollectionPromise;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jsx": "text/babel; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const starterPosts = [
  {
    id: "morning-yoga-flow",
    status: "published",
    category: "Yoga",
    title: "A Gentle 20-Minute Morning Yoga Flow for Lasting Energy",
    excerpt: "Wake up your spine, open tight hips, and settle your breath with a beginner-friendly flow that fits before work.",
    content: "Begin with three slow breaths in child's pose, then move through cat-cow, low lunge, half splits, and a simple sun salutation. Keep the pace easy and finish with two minutes of seated breathing.",
    author: "Maya Ellison",
    date: "May 14, 2026",
    image: "https://images.unsplash.com/photo-1545389336-cf090694435e?auto=format&fit=crop&w=900&q=82"
  },
  {
    id: "calm-strength-method",
    status: "published",
    category: "Fitness",
    title: "The Calm Strength Method: Build Muscle Without Burnout",
    excerpt: "Use progressive overload, thoughtful recovery, and realistic weekly volume to get stronger while protecting your energy.",
    content: "Train three or four days per week, keep two reps in reserve on most sets, and add load only when your form feels steady. Strength grows best when recovery is part of the plan.",
    author: "Andre Wells",
    date: "May 11, 2026",
    image: "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=900&q=82"
  },
  {
    id: "mindful-eating-habits",
    status: "published",
    category: "Wellness",
    title: "Seven Mindful Eating Habits That Support Healthy Weight Loss",
    excerpt: "Small nutrition rituals can lower stress around food and help you feel satisfied without rigid tracking.",
    content: "Start by slowing down your first five bites, adding protein to breakfast, and building plates around color, fiber, and satisfaction. Consistency matters more than perfect rules.",
    author: "Nina Patel",
    date: "May 8, 2026",
    image: "https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=900&q=82"
  },
  {
    id: "home-workout-plan",
    status: "published",
    category: "Exercise",
    title: "Home Workout Plan: Three Full-Body Sessions Per Week",
    excerpt: "A practical no-commute plan with squats, hinges, pushes, pulls, and core work for busy schedules.",
    content: "Alternate squat, hinge, push, pull, and carry patterns. Use backpacks, bands, dumbbells, or bodyweight, and progress by adding reps before adding load.",
    author: "Andre Wells",
    date: "May 4, 2026",
    image: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=900&q=82"
  },
  {
    id: "breathwork-better-sleep",
    status: "published",
    category: "Meditation",
    title: "Breathwork for Better Sleep: A Five-Minute Evening Reset",
    excerpt: "Wind down with simple breathing patterns that signal safety, soften tension, and prepare the body for rest.",
    content: "Try inhaling for four, exhaling for six, and letting the shoulders drop on each out breath. Keep the practice gentle enough that you look forward to repeating it.",
    author: "Maya Ellison",
    date: "April 29, 2026",
    image: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=900&q=82"
  },
  {
    id: "mobility-essentials",
    status: "published",
    category: "Fitness",
    title: "Mobility Essentials for Runners, Lifters, and Desk Workers",
    excerpt: "A targeted mobility sequence for ankles, hips, thoracic spine, and shoulders to move better every day.",
    content: "Spend two minutes each on ankle rocks, hip flexor breathing, thoracic rotations, and wall slides. Mobility works best when it is short enough to do often.",
    author: "Nina Patel",
    date: "April 24, 2026",
    image: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=900&q=82"
  }
];

function ensurePostsFile() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(postsFile)) writeFileSync(postsFile, JSON.stringify(starterPosts, null, 2));
}

function ensureAdminFile() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(adminFile)) {
    writeFileSync(adminFile, JSON.stringify({
      username: "admin",
      salt: "lumawell-local-admin-v1",
      passwordHash: "ac6466ce2d7e65cd4b2605e5dd3c726c95fb21e868927afc5ccad93d5a158332"
    }, null, 2));
  }
}

function readJsonPosts() {
  ensurePostsFile();
  return JSON.parse(readFileSync(postsFile, "utf8"));
}

function writeJsonPosts(posts) {
  ensurePostsFile();
  writeFileSync(postsFile, JSON.stringify(posts, null, 2));
}

async function getPostsCollection() {
  if (!mongoUri) return null;
  if (!postsCollectionPromise) {
    postsCollectionPromise = (async () => {
      let MongoClient;
      try {
        ({ MongoClient } = await import("mongodb"));
      } catch (error) {
        if (error.code === "ERR_MODULE_NOT_FOUND") {
          console.warn("MongoDB driver is not installed locally. Falling back to data/posts.json.");
          return null;
        }
        throw error;
      }
      const client = new MongoClient(mongoUri);
      await client.connect();
      const collection = client.db(mongoDbName).collection(mongoCollectionName);
      await collection.createIndex({ id: 1 }, { unique: true });
      await collection.createIndex({ status: 1, date: -1 });
      if (await collection.countDocuments() === 0) {
        await collection.insertMany(starterPosts);
      }
      return collection;
    })();
  }
  return postsCollectionPromise;
}

async function readPosts() {
  const collection = await getPostsCollection();
  if (!collection) return readJsonPosts();
  return collection.find({}, { projection: { _id: 0 } }).sort({ _id: -1 }).toArray();
}

async function createPost(post) {
  const collection = await getPostsCollection();
  if (!collection) {
    const posts = readJsonPosts();
    posts.unshift(post);
    writeJsonPosts(posts);
    return post;
  }
  await collection.insertOne(post);
  return post;
}

async function updatePost(id, post) {
  const collection = await getPostsCollection();
  if (!collection) {
    const posts = readJsonPosts();
    const index = posts.findIndex((item) => item.id === id);
    if (index === -1) return null;
    posts[index] = post;
    writeJsonPosts(posts);
    return post;
  }
  const result = await collection.findOneAndUpdate(
    { id },
    { $set: post },
    { returnDocument: "after", projection: { _id: 0 } }
  );
  return result;
}

async function deletePost(id) {
  const collection = await getPostsCollection();
  if (!collection) {
    const posts = readJsonPosts();
    const index = posts.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const [deleted] = posts.splice(index, 1);
    writeJsonPosts(posts);
    return deleted;
  }
  const deleted = await collection.findOneAndDelete({ id }, { projection: { _id: 0 } });
  return deleted;
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((cookie) => {
    const [name, ...value] = cookie.trim().split("=");
    return [name, decodeURIComponent(value.join("=") || "")];
  }).filter(([name]) => name));
}

function isAuthenticated(request) {
  const token = parseCookies(request).lumawell_session;
  const session = token && sessions.get(token);
  if (!session) return false;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function setSessionCookie(response, token) {
  response.setHeader("Set-Cookie", `lumawell_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", "lumawell_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function slugify(value) {
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || `post-${Date.now()}`;
}

function cleanPost(input, existing = {}) {
  const title = String(input.title || "").trim();
  const content = String(input.content || "").trim();
  if (title.length < 4) return { error: "Title must be at least 4 characters." };
  if (content.length < 20) return { error: "Article content must be at least 20 characters." };

  const excerpt = String(input.excerpt || content.slice(0, 150)).trim();
  return {
    status: "published",
    category: String(input.category || "Wellness").trim().slice(0, 40),
    title,
    excerpt: excerpt.length > 190 ? `${excerpt.slice(0, 187)}...` : excerpt,
    content,
    author: String(input.author || "LumaWell Editor").trim().slice(0, 60),
    date: existing.date || new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    image: String(input.image || "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=900&q=82").trim(),
  };
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/session" && request.method === "GET") {
    sendJson(response, 200, { authenticated: isAuthenticated(request) });
    return true;
  }

  if (url.pathname === "/api/login" && request.method === "POST") {
    try {
      ensureAdminFile();
      const admin = JSON.parse(readFileSync(adminFile, "utf8"));
      const body = JSON.parse(await readBody(request) || "{}");
      const validUsername = String(body.username || "") === admin.username;
      const validPassword = hashPassword(String(body.password || ""), admin.salt) === admin.passwordHash;

      if (!validUsername || !validPassword) {
        sendJson(response, 401, { error: "Invalid admin credentials." });
        return true;
      }

      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { username: admin.username, expires: Date.now() + 24 * 60 * 60 * 1000 });
      setSessionCookie(response, token);
      sendJson(response, 200, { authenticated: true });
    } catch (error) {
      sendJson(response, 400, { error: error.message || "Unable to log in." });
    }
    return true;
  }

  if (url.pathname === "/api/logout" && request.method === "POST") {
    const token = parseCookies(request).lumawell_session;
    if (token) sessions.delete(token);
    clearSessionCookie(response);
    sendJson(response, 200, { authenticated: false });
    return true;
  }

  if (url.pathname === "/api/posts" && request.method === "GET") {
    sendJson(response, 200, (await readPosts()).filter((post) => post.status === "published"));
    return true;
  }

  if (url.pathname === "/api/posts" && request.method === "POST") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login is required to publish posts." });
      return true;
    }

    try {
      const body = JSON.parse(await readBody(request) || "{}");
      const cleaned = cleanPost(body);
      if (cleaned.error) {
        sendJson(response, 400, { error: cleaned.error });
        return true;
      }

      const posts = await readPosts();
      const baseId = slugify(cleaned.title);
      let id = baseId;
      let suffix = 2;
      while (posts.some((post) => post.id === id)) id = `${baseId}-${suffix++}`;

      const post = { id, ...cleaned };
      await createPost(post);
      sendJson(response, 201, post);
    } catch (error) {
      sendJson(response, 400, { error: error.message || "Unable to create post." });
    }
    return true;
  }

  const postRoute = url.pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (postRoute && ["PUT", "DELETE"].includes(request.method)) {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login is required to manage posts." });
      return true;
    }

    const id = decodeURIComponent(postRoute[1]);
    const posts = await readPosts();
    const index = posts.findIndex((post) => post.id === id);

    if (index === -1) {
      sendJson(response, 404, { error: "Post not found." });
      return true;
    }

    if (request.method === "DELETE") {
      const deleted = await deletePost(id);
      sendJson(response, 200, { deleted: true, post: deleted });
      return true;
    }

    try {
      const body = JSON.parse(await readBody(request) || "{}");
      const cleaned = cleanPost(body, posts[index]);
      if (cleaned.error) {
        sendJson(response, 400, { error: cleaned.error });
        return true;
      }

      const updated = await updatePost(id, { ...posts[index], ...cleaned, id: posts[index].id });
      sendJson(response, 200, updated);
    } catch (error) {
      sendJson(response, 400, { error: error.message || "Unable to update post." });
    }
    return true;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "API route not found." });
    return true;
  }

  return false;
}

createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  if (await handleApi(request, response, url)) return;

  const requested = url.pathname === "/" ? "/index.html" : url.pathname === "/admin" ? "/admin.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requested));

  if (!filePath.startsWith(normalize(root))) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) throw new Error("Not a file");
    response.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, () => {
  console.log(`LumaWell is running at http://localhost:${port}`);
});
