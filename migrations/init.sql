-- Run this SQL to create minimal schema for Vercel serverless backend
CREATE TABLE IF NOT EXISTS files (
  id SERIAL PRIMARY KEY,
  original_name TEXT NOT NULL,
  filename TEXT NOT NULL,
  filepath TEXT,
  file_size BIGINT,
  total_pages INTEGER,
  tag_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
  page INTEGER,
  type TEXT,
  author TEXT,
  content TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
