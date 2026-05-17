# LumaWell Studio

A modern responsive single-page wellness blog with a no-dependency Node backend for writing and publishing posts.

Run it locally:

```bash
node server.mjs
```

Then open `http://localhost:4173`.

The local server also provides a small publishing backend:

- `GET /api/posts` returns published posts.
- `POST /api/posts` creates and publishes a new post after admin login.
- `PUT /api/posts/:id` edits an existing post after admin login.
- `DELETE /api/posts/:id` deletes a post after admin login.
- `/admin` opens the private publishing dashboard.
- Posts are stored in `data/posts.json`.
- Admin credentials are configured in `data/admin.json`. The current username is `admin`.

## MongoDB + Render

The app uses `data/posts.json` locally by default. On Render, set these environment variables to store posts in MongoDB instead:

```bash
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-url>/lumawell?retryWrites=true&w=majority
MONGODB_DB=lumawell
MONGODB_COLLECTION=posts
```

Render setup:

1. Push this project to GitHub.
2. Create a MongoDB Atlas free cluster.
3. In Atlas, create a database user and allow Render network access. For a quick start, Atlas network access can use `0.0.0.0/0`, then tighten it later.
4. Create a Render Web Service from your GitHub repo.
5. Use `npm install` as the build command.
6. Use `npm start` as the start command.
7. Add the environment variables above in Render.

The page uses remote royalty-free placeholder imagery from Unsplash, so an internet connection is needed for the full visual experience.
